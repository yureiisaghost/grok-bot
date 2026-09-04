import type { ChartBox, ChartGeometry, ChartMarker, Grade, OhlcvBar, PlanOfAttack, Readiness } from "../src/types"
import {
  adrPct,
  bannedInstrument,
  chasedThrough,
  completedDailyBars,
  dollarAdv,
  range52,
  thrustLegCount,
} from "./bars"
import { finalistConfig } from "./finalistConfig"
import { nowPtStamp } from "./http"
import { readActiveAccount, sizeFromAccount } from "./accountSnapshot"
import {
  atr,
  daysUntil,
  ema,
  highest,
  last,
  lowest,
  pct,
  roundPx,
  rsi,
  slope,
  sma,
} from "./indicators"
import type { MarketPack } from "./market"
import { beatsSpy, rsRaw } from "./rs"
import { sessionRangePct, writeStructuralStop } from "./stopWriter"
import { trendTemplate, weeklyStageFrom } from "./template"
import { priorThrust60d, type PriorThrust } from "./thrust"
import { findCoils, lastCoilPivot, vcpProgression } from "./vcpSwings"

interface Sketch {
  pivot: number | null
  box: ChartBox | null
  markers: ChartMarker[]
  levelLabel: string | null
}

interface Candidate {
  family: string
  grade: Grade
  score: number
  entryMethod: string
  entryTrigger: string
  invalidation: string
  stop: string
  thesis: string
  plan: string
  stopPrice: number | null
  entryPrice: number | null
  sketch: Sketch
  readiness?: Readiness
  flagRetracePct?: number
  priorThrust60d?: number
}

const MARK = {
  pivot: "#5ec8e6",
  low: "#f07178",
  reclaim: "#3ecf8e",
}

function emptySketch(): Sketch {
  return { pivot: null, box: null, markers: [], levelLabel: null }
}

function livedAbove20(
  bars: OhlcvBar[],
  ema20: Array<number | null>,
  dipStart: number,
  lookback = 12,
) {
  const end = Math.max(0, dipStart - 1)
  const start = Math.max(0, end - lookback + 1)
  if (end < start) return false
  let above = 0
  let n = 0
  for (let j = start; j <= end; j++) {
    const emaJ = ema20[j]
    if (emaJ === null) continue
    n += 1
    if (bars[j].close > emaJ) above += 1
  }
  return n >= 8 && above / n >= 0.65
}

function day(bar: OhlcvBar) {
  return bar.time.slice(0, 10)
}

function argMax(values: number[], start: number, end: number) {
  let idx = Math.max(0, start)
  const lastIdx = Math.min(values.length - 1, end)
  for (let i = idx + 1; i <= lastIdx; i++) {
    if (values[i] > values[idx]) idx = i
  }
  return idx
}

function argMin(values: number[], start: number, end: number) {
  let idx = Math.max(0, start)
  const lastIdx = Math.min(values.length - 1, end)
  for (let i = idx + 1; i <= lastIdx; i++) {
    if (values[i] < values[idx]) idx = i
  }
  return idx
}

function boxFrom(bars: OhlcvBar[], start: number, end: number, label: string): ChartBox {
  const s = Math.max(0, Math.min(start, end))
  const e = Math.min(bars.length - 1, Math.max(start, end))
  let high = -Infinity
  let low = Infinity
  for (let i = s; i <= e; i++) {
    high = Math.max(high, bars[i].high)
    low = Math.min(low, bars[i].low)
  }
  return { from: day(bars[s]), to: day(bars[e]), high, low, label }
}

function rTargets(entry: number | null, stop: number | null) {
  if (!entry || !stop || entry <= stop) return { r1: null, r2: null, r3: null }
  const r = entry - stop
  return {
    r1: roundPx(entry + r),
    r2: roundPx(entry + 2 * r),
    r3: roundPx(entry + 3 * r),
  }
}

function describeGap(lastPx: number, level: number, atrV: number | null, label: string) {
  const pctAway = ((level - lastPx) / lastPx) * 100
  const atrAway = atrV && atrV > 0 ? (level - lastPx) / atrV : null
  const atrBit = atrAway === null ? "" : ` / ${Math.abs(atrAway).toFixed(1)} ATR`
  let text: string
  if (Math.abs(pctAway) < 0.2) text = `At ${label} $${level.toFixed(2)}`
  else if (pctAway > 0) text = `${pctAway.toFixed(1)}%${atrBit} under ${label} $${level.toFixed(2)}`
  else text = `${Math.abs(pctAway).toFixed(1)}%${atrBit} above ${label} $${level.toFixed(2)}`
  return { text, pct: pctAway, atr: atrAway, label }
}

function clipGeometry(chart: OhlcvBar[], sketch: Sketch, caption: string | null, gap: ReturnType<typeof describeGap> | null): ChartGeometry {
  const start = chart[0] ? day(chart[0]) : ""
  const times = new Set(chart.map(day))
  let box = sketch.box
  if (box) {
    if (box.to < start) box = null
    else if (box.from < start) box = { ...box, from: start }
  }
  return {
    box,
    markers: sketch.markers.filter((marker) => times.has(marker.time)),
    caption: caption,
    pctToLevel: gap?.pct ?? null,
    atrToLevel: gap?.atr ?? null,
    levelLabel: gap?.label ?? sketch.levelLabel,
  }
}

const STOP_SANDWICH = "1.5 ATR / 1 ADR / 8%"

function limitCeil(trigger: number, atrV: number | null) {
  const capPct = trigger * 0.02
  const capAtr = atrV != null && atrV > 0 ? 0.5 * atrV : capPct
  return roundPx(trigger + Math.min(capPct, capAtr))
}

function stopLimitTrigger(trigger: number, atrV: number | null, where: string) {
  const ceil = limitCeil(trigger, atrV)
  return `Buy stop-limit through ${where} ${trigger.toFixed(2)}; limit no higher than ${ceil.toFixed(2)} (tighter of 2% and 0.5 ATR).`
}

function wideStopCopy(reason: "too_wide" | "too_tight" | string) {
  return reason === "too_wide"
    ? `wider than ${STOP_SANDWICH}`
    : "inside 0.25 ATR noise"
}

function detectMaPullback(
  bars: OhlcvBar[],
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  atr14: Array<number | null>,
  volSma: Array<number | null>,
  weeklyTrend: PlanOfAttack["weeklyTrend"],
  thrust: PriorThrust | null,
  adr: number | null,
): Candidate | null {
  const i = bars.length - 1
  const close = bars[i].close
  const e20 = last(ema20)
  const e50 = last(ema50)
  const a14 = last(atr14)
  if (e20 === null || e50 === null) return null
  const stackClean = e20 > e50 && slope(ema50, 8) >= 0
  const rising = slope(ema20, 8) > 0 && e20 >= e50 * 0.995
  const above50 = close > e50
  const volAvg = last(volSma)
  const expanding = volAvg != null && bars[i].volume > volAvg * 1.5
  const below20 = close < e20 * 0.995
  const below50 = close < e50 * 0.995
  if (below20 && below50) return null
  if (below20 && expanding && close < e50 * 1.01) return null
  if (!rising && !stackClean) return null
  if (!above50) return null
  const skipThrust = stackClean && weeklyTrend === "up"
  const thrustOk = skipThrust || Boolean(thrust?.pass)

  const look = Math.min(15, bars.length)
  let tagged = false
  let reclaim = false
  let tagLow = close
  let tagStart = i
  let tagLowIdx = i
  let reclaimIdx: number | null = null
  for (let j = i - look + 1; j <= i; j++) {
    if (j < 1) continue
    const emaJ = ema20[j]
    if (emaJ === null) continue
    if (bars[j].low <= emaJ * 1.012) {
      if (!tagged) tagStart = j
      tagged = true
      if (bars[j].low < tagLow) {
        tagLow = bars[j].low
        tagLowIdx = j
      }
    }
    const prevEma = ema20[j - 1]
    if (
      prevEma !== null
      && bars[j - 1].close <= prevEma
      && bars[j].close > Math.max(prevEma, emaJ)
      && bars[j].close > bars[j].open
    ) {
      reclaim = true
      reclaimIdx = j
    }
  }

  const dist20 = pct(e20, close)
  const swingHigh = highest(bars.map((b) => b.high), i, 25)
  const swingIdx = argMax(bars.map((b) => b.high), Math.max(0, i - 24), i)
  const extended = dist20 > 6 || pct(e20, close) > (a14 ? (a14 / close) * 100 * 2.2 : 8)
  const lived = livedAbove20(bars, ema20, tagStart, 12)
  const held = tagged && !below20 && close >= e20 * 0.995
  const tangled = !stackClean
  const atrProbe = a14 != null && a14 > 0 && tagLow <= e20 && (e20 - tagLow) >= a14
  const smashBounce = sessionRangePct(bars, 10, close) >= 0.25
  const holdQualified = reclaim || (held && atrProbe)

  const maSketch = (pivot: number, extra: ChartMarker[] = [], box: ChartBox | null = null): Sketch => ({
    pivot,
    box,
    levelLabel: "20 EMA",
    markers: extra,
  })

  const stamp = { priorThrust60d: thrust?.rangePct }

  if (holdQualified && lived && stackClean && above50 && dist20 < 5 && thrustOk && !below20 && (!smashBounce || reclaim)) {
    const holdBar = bars[reclaimIdx ?? tagLowIdx]
    const trigger = roundPx(Math.max(holdBar.high, e20) * 1.004)
    const written = writeStructuralStop({
      structural: tagLow,
      bars,
      boxStart: tagStart,
      boxEnd: i,
      trigger,
      last: close,
      atr: a14,
      adrPct: adr,
    })
    const markers: ChartMarker[] = [
      { time: day(bars[tagLowIdx]), position: "belowBar", shape: "arrowUp", text: "Probe", color: MARK.low },
    ]
    if (reclaimIdx !== null) {
      markers.push({ time: day(bars[reclaimIdx]), position: "aboveBar", shape: "circle", text: "Reclaim", color: MARK.reclaim })
    }
    const kind = reclaim ? "reclaim" : "hold"
    if (!written.ok) {
      return {
        family: "MA Pullback / Key Level Reclaim",
        grade: "Developing",
        score: 56,
        readiness: "needs_close",
        entryMethod: "None yet — stop does not fit",
        entryTrigger: `Structure exists but the stop is ${wideStopCopy(written.reason)}. Not a Candidate.`,
        invalidation: `Sustained break below the 20 EMA (~${e20.toFixed(2)}) with volume.`,
        stop: `Not a Candidate stop until the invalidation sits inside ${STOP_SANDWICH}.`,
        stopPrice: null,
        entryPrice: null,
        thesis: smashBounce
          ? `Smash-bounce range in the last 10 sessions. Rewritten stop does not fit a Candidate MA.`
          : `MA probe exists but the only valid invalidation is too wide or too tight for a Candidate.`,
        plan: `Leave it Developing. Do not limit-buy the 20 on the way down.`,
        sketch: maSketch(trigger, markers, boxFrom(bars, tagStart, i, kind === "reclaim" ? "Reclaim" : "Hold")),
        ...stamp,
      }
    }
    const stop = written.stop
    return {
      family: "MA Pullback / Key Level Reclaim",
      grade: "Candidate",
      score: reclaim ? 80 : 74,
      readiness: "near",
      entryMethod: "Buy Stop-Limit",
      entryTrigger: stopLimitTrigger(trigger, a14, `the ${kind} high / 20 EMA`),
      invalidation: `Sustained trade back below the 20 EMA (~${e20.toFixed(2)}) with volume, or loss of the ${kind} structure.`,
      stop: `${stop.toFixed(2)} (below the pullback low / MA cluster)`,
      stopPrice: stop,
      entryPrice: trigger,
      thesis: reclaim
        ? `Price probed the rising 20 EMA (~${e20.toFixed(2)}) / 50 EMA (~${e50.toFixed(2)}) and closed back above that decision zone. Reclaim printed. Do not limit-buy the 20 on the way down.`
        : `Price made a >= 1 ATR dip into the rising 20 EMA (~${e20.toFixed(2)}) and held. 50 EMA (~${e50.toFixed(2)}) is rising. Not a grind on the 20.`
      ,
      plan: `Do not limit-buy the 20 on the way down. After the daily ${kind} close, ${stopLimitTrigger(trigger, a14, `the ${kind}`)}. Hard stop ${stop.toFixed(2)}. No chase if the next session gaps through the limit ceiling.`,
      sketch: maSketch(trigger, markers, boxFrom(bars, tagStart, i, reclaim ? "Reclaim" : "Hold")),
      ...stamp,
    }
  }

  if (tagged && held && !reclaim && !atrProbe) {
    return {
      family: "MA Pullback / Key Level Reclaim",
      grade: "Developing",
      score: 54,
      readiness: "forming",
      entryMethod: "None yet",
      entryTrigger: `Tape is coiling on the 20 EMA (~${e20.toFixed(2)}) without a 1-ATR probe or a reclaim close. Not a Candidate hold.`,
      invalidation: `Sustained break below the 50 EMA (~${e50.toFixed(2)}) with expanding volume.`,
      stop: "Not defined yet.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Closing on the 20 EMA is not a pullback. Needs a distinct >= 1 ATR dip into the 20 that holds, or a printed reclaim close.`,
      plan: `Watch. Promote only after a real probe or reclaim. Do not limit-buy the 20 on the way down.`,
      sketch: maSketch(e20, [
        { time: day(bars[tagLowIdx]), position: "belowBar", shape: "arrowUp", text: "Tag", color: MARK.low },
      ], boxFrom(bars, tagStart, i, "Coil")),
      ...stamp,
    }
  }

  if (tagged && above50 && (below20 || !reclaim && !held)) {
    const stop = roundPx(Math.min(tagLow, e50) * 0.985)
    return {
      family: "MA Pullback / Key Level Reclaim",
      grade: "Developing",
      score: 58,
      readiness: "needs_close",
      entryMethod: "None yet — wait for reclaim",
      entryTrigger: `Needs a reclaim close back above the 20 EMA (~${e20.toFixed(2)}) after the 50 test. Do not limit-buy the 20 on the way down.`,
      invalidation: `Sustained break below the 50 EMA (~${e50.toFixed(2)}) with expanding volume.`,
      stop: `${stop.toFixed(2)} (below the pullback low / 50 EMA) — not live until reclaim.`,
      stopPrice: null,
      entryPrice: null,
      thesis: `Tape tagged the 20 EMA (~${e20.toFixed(2)}) and has not printed a hold or reclaim close. 50 EMA (~${e50.toFixed(2)}) is still backup. Falling-20 limit is not a Candidate plan.`,
      plan: `Wait. If it tests the 50 and reclaims the 20 on a closing basis, then Stop-Limit above the reclaim high. Cash until that close prints.`,
      sketch: maSketch(e20, [
        { time: day(bars[tagLowIdx]), position: "belowBar", shape: "arrowUp", text: "Tag", color: MARK.low },
      ], boxFrom(bars, tagStart, i, "Pullback")),
      ...stamp,
    }
  }

  if (tangled) {
    return null
  }

  if (extended) {
    return {
      family: "MA Pullback / Key Level Reclaim",
      grade: "Developing",
      score: 52,
      entryMethod: "None yet — wait for the pullback",
      entryTrigger: `Watch only. Prefer a controlled pullback into the rising 20 EMA (~${e20.toFixed(2)}), currently extended (~${dist20.toFixed(1)}% above).`,
      invalidation: `Sustained break below the rising 20 EMA with volume, or a disorderly dump through the 50 EMA (~${e50.toFixed(2)}).`,
      stop: `Not defined until a pullback/reclaim gives a structural low.`,
      stopPrice: null,
      entryPrice: null,
      thesis: `Higher-timeframe trend is up and MAs are rising, but price is extended from the 20 EMA / recent swing high (~${swingHigh.toFixed(2)}). This is a wait-for-pullback name, not an entry.`,
      plan: `Do not chase. Monitor for an orderly pullback into ~${e20.toFixed(2)} with declining volume, or a probe-and-reclaim of that level. Only then write a defined trigger.`,
      sketch: maSketch(e20, [
        { time: day(bars[swingIdx]), position: "aboveBar", shape: "arrowDown", text: "High", color: MARK.pivot },
      ]),
    }
  }

  if (rising && above50 && dist20 < 8) {
    return {
      family: "MA Pullback / Key Level Reclaim",
      grade: "Developing",
      score: 46,
      entryMethod: "None yet",
      entryTrigger: `Watch for a test of the rising 20 EMA (~${e20.toFixed(2)}) with reversal confirmation.`,
      invalidation: `Loss of the 50 EMA (~${e50.toFixed(2)}) on volume.`,
      stop: "Not defined yet.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Trend filter is constructive (above a rising 20/50 EMA stack) but there is no clean, defined pullback or reclaim trigger yet.`,
      plan: `Keep it on watch. Do not force an entry while the pullback has not formed.`,
      sketch: maSketch(e20),
    }
  }

  return null
}

function detectFlag(
  bars: OhlcvBar[],
  ema20: Array<number | null>,
  ema50: Array<number | null>,
  atr14: Array<number | null>,
  volSma: Array<number | null>,
  thrust: PriorThrust | null,
  adr: number | null,
): Candidate | null {
  const i = bars.length - 1
  const closes = bars.map((b) => b.close)
  const highs = bars.map((b) => b.high)
  const lows = bars.map((b) => b.low)
  const volumes = bars.map((b) => b.volume)
  const e20 = last(ema20)
  const e50 = last(ema50)
  const a14 = last(atr14)
  if (e20 === null) return null

  let best: { start: number; end: number; gain: number; volRatio: number; poleBars: number; rank: number } | null = null
  const minStart = Math.max(0, i - 40)
  for (let end = i - 3; end >= minStart + 3; end--) {
    for (let len = 3; len <= 20; len++) {
      const start = end - len
      if (start < minStart) continue
      const startLow = lowest(lows, start, 2)
      const endHigh = highest(highs, end, 2)
      const gain = pct(startLow, endHigh)
      if (gain < 8) continue
      const poleBars = end - start + 1
      const windowVol = volumes.slice(start, end + 1).reduce((a, b) => a + b, 0) / poleBars
      const baseVol = last(volSma.slice(0, start + 1)) || windowVol
      const volRatio = baseVol ? windowVol / baseVol : 1
      if (volRatio < 1.25) continue
      const speed = gain / poleBars
      const rank = gain * volRatio * Math.min(speed, 2)
      if (!best || rank > best.rank) {
        best = { start, end, gain, volRatio, poleBars, rank }
      }
    }
  }
  if (!best) return null

  const poleLow = lowest(lows, best.start, 3)
  const poleHigh = highest(highs, best.end, 2)
  const poleHeight = poleHigh - poleLow
  if (poleHeight <= 0) return null
  const stamp = { priorThrust60d: thrust?.rangePct }
  const poleOk = best.gain >= 10 && best.volRatio >= 1.5 && best.poleBars <= 15
  const poleMarkers: ChartMarker[] = [
    { time: day(bars[argMin(lows, best.start, best.end)]), position: "belowBar", shape: "circle", text: "Pole", color: MARK.low },
    { time: day(bars[argMax(highs, best.start, best.end)]), position: "aboveBar", shape: "arrowDown", text: "Pole high", color: MARK.pivot },
  ]
  const after = bars.slice(best.end + 1)
  if (after.length < 3) {
    return {
      family: "Bull Flag / First Pullback after Impulse",
      grade: "Developing",
      score: 50,
      entryMethod: "None yet",
      entryTrigger: `Impulse is young. Watch for an orderly first pullback toward the 20 EMA (~${e20.toFixed(2)}) or a tight flag under ~${poleHigh.toFixed(2)}.`,
      invalidation: `Loss of the impulse low structure near ${poleLow.toFixed(2)}, or a wide choppy base.`,
      stop: "Not defined yet.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Detected ${poleOk ? "a" : "a grind-like"} impulse (~${best.gain.toFixed(0)}% over ${best.poleBars} bars). No flag/first pullback has formed yet.`,
      plan: `Do not chase the impulse. Wait for 5-15 days of tighter, lower-volume consolidation or a controlled pullback into the rising 20 EMA.`,
      sketch: { pivot: poleHigh, box: null, markers: poleMarkers, levelLabel: "pole high" },
      ...stamp,
    }
  }

  const flagLow = lowest(lows, i, after.length)
  const flagHigh = highest(highs, i, Math.max(3, after.length))
  const retrace = (poleHigh - flagLow) / poleHeight
  const flagRetracePct = retrace * 100
  const flagDays = after.length
  const flagVol = after.reduce((a, b) => a + b.volume, 0) / after.length
  const poleVol = volumes.slice(best.start, best.end + 1).reduce((a, b) => a + b, 0) / (best.end - best.start + 1)
  const volDry = flagVol < poleVol * 0.85
  const stillAboveMa = closes[i] >= e20 * 0.98
  const above50 = e50 === null || closes[i] > e50
  const flagLowIdx = argMin(lows, best.end + 1, i)
  const flagBox = boxFrom(bars, best.end + 1, i, "Flag")
  const flagSketch = (pivot: number): Sketch => ({
    pivot,
    box: flagBox,
    levelLabel: "flag high",
    markers: [
      ...poleMarkers,
      { time: day(bars[flagLowIdx]), position: "belowBar", shape: "arrowUp", text: "Flag low", color: MARK.low },
    ],
  })
  const distSpike = after.some((bar) => bar.close < bar.open && poleVol > 0 && bar.volume > poleVol * 1.15)
  const trigger = roundPx(Math.max(flagHigh, poleHigh) * 1.003)
  const chased = chasedThrough(closes[i], trigger, a14, closes[i])

  if (retrace > 0.62) return null
  if (flagDays > 15) return null

  if (chased) {
    return {
      family: "Bull Flag / First Pullback after Impulse",
      grade: "Developing",
      score: 48,
      entryMethod: "None — no chase",
      entryTrigger: `Breakout through ~${poleHigh.toFixed(2)} already happened. Do not chase. Wait for a first pullback into the breakout/20 EMA zone.`,
      invalidation: `Failure back below the breakout area / 20 EMA (~${e20.toFixed(2)}) on volume.`,
      stop: "Not defined until a pullback gives a structural low.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Impulse and follow-through already ran. Under the rules we do not chase extended breakouts.`,
      plan: `Cash stays the default. Revisit if it builds a controlled pullback into ~${e20.toFixed(2)} or the breakout level.`,
      sketch: flagSketch(poleHigh),
      flagRetracePct,
      ...stamp,
    }
  }

  const geometryOk = retrace <= 0.5 && retrace >= 0.12 && volDry && stillAboveMa && flagDays >= 5 && flagDays <= 15
  const preferredRetrace = retrace >= 0.20 && retrace <= 0.38
  const canCandidate = geometryOk && poleOk && !distSpike && above50 && Boolean(thrust?.pass)
  const written = canCandidate
    ? writeStructuralStop({
      structural: flagLow,
      bars,
      boxStart: best.end + 1,
      boxEnd: i,
      trigger,
      last: closes[i],
      atr: a14,
      adrPct: adr,
    })
    : null

  if (canCandidate && written?.ok) {
    const stop = written.stop
    return {
      family: "Bull Flag / First Pullback after Impulse",
      grade: "Candidate",
      score: preferredRetrace ? 80 : 70,
      readiness: "near",
      entryMethod: "Buy Stop-Limit",
      entryTrigger: stopLimitTrigger(trigger, a14, "the flag high"),
      invalidation: `Loss of the flag low near ${flagLow.toFixed(2)}, or the base becoming wide and choppy.`,
      stop: `${stop.toFixed(2)} (below the last higher low / flag structure, not the pole base)`,
      stopPrice: stop,
      entryPrice: trigger,
      thesis: `Impulse (~${best.gain.toFixed(0)}% pole over ${best.poleBars} bars, ${best.volRatio.toFixed(1)}x vol) then ${flagDays} days of digestion, retracing ~${flagRetracePct.toFixed(0)}% of the pole with cooling volume.`,
      plan: `${stopLimitTrigger(trigger, a14, "the flag high")} Hard stop ${stop.toFixed(2)} under the flag structure. Measured-move / R3 is a map mark only.`,
      sketch: flagSketch(Math.max(flagHigh, poleHigh)),
      flagRetracePct,
      ...stamp,
    }
  }

  if (canCandidate && written && !written.ok) {
    return {
      family: "Bull Flag / First Pullback after Impulse",
      grade: "Developing",
      score: 52,
      entryMethod: "None yet — stop too wide",
      entryTrigger: `Flag geometry exists but the only invalidation sits outside ${STOP_SANDWICH}. Not a Candidate.`,
      invalidation: `Loss of the impulse low near ${poleLow.toFixed(2)} or a wide, choppy range.`,
      stop: "Not a Candidate stop until a tighter higher-low invalidation exists.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Impulse ~${best.gain.toFixed(0)}% then ${flagDays} days (retrace ~${flagRetracePct.toFixed(0)}%). Stop rewrite still too wide.`,
      plan: `Leave it Developing. A cavern flag low is a wide base, not a Candidate flag.`,
      sketch: flagSketch(poleHigh),
      flagRetracePct,
      ...stamp,
    }
  }

  if (stillAboveMa && retrace <= 0.62) {
    const young = flagDays < 5
    const grind = !poleOk
    return {
      family: "Bull Flag / First Pullback after Impulse",
      grade: "Developing",
      score: distSpike ? 48 : 54,
      entryMethod: "None yet",
      entryTrigger: young
        ? `3-4 day pause is not a flag. Prefer 5-15 days of digestion under ~${poleHigh.toFixed(2)}.`
        : grind
          ? `Pole is a grind, not an impulse. Needs a real pole (>=10% with 1.5x volume) before a Candidate flag.`
          : `Early or loose post-impulse base. Prefer a tighter 20-38% flag under ~${poleHigh.toFixed(2)}.`,
      invalidation: `Sustained break of the impulse low near ${poleLow.toFixed(2)} or a wide, choppy range.`,
      stop: "Not defined yet.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Impulse ~${best.gain.toFixed(0)}% over ${best.poleBars} bars, then ${flagDays} days (retrace ~${flagRetracePct.toFixed(0)}%). ${distSpike ? "Distribution-day volume inside the flag caps this." : grind ? "Grind, not a pole." : young ? "Pause too short to be a flag." : "Not tight enough to Candidate."}`,
      plan: `Do not force it. Let the base prove itself for 5-15 days with contracting volume.`,
      sketch: flagSketch(poleHigh),
      flagRetracePct,
      ...stamp,
    }
  }

  return null
}

function detectVcp(
  bars: OhlcvBar[],
  ema50: Array<number | null>,
  atr14: Array<number | null>,
  volSma: Array<number | null>,
  thrust: PriorThrust | null,
  adr: number | null,
): Candidate | null {
  const i = bars.length - 1
  if (bars.length < 70) return null
  const e50 = last(ema50)
  const aNow = last(atr14)
  if (e50 === null || aNow === null) return null
  if (bars[i].close < e50) return null

  const coils = findCoils(bars)
  if (coils.length < 2) return null
  const lastCoil = coils[coils.length - 1]
  const prog = vcpProgression(coils)
  const pivotHit = lastCoilPivot(bars, lastCoil)
  const pivot = pivotHit.high
  const pivotIdx = pivotHit.idx
  const coilLow = lastCoil.low
  const coilLowIdx = lastCoil.lowIdx
  const dist = pct(bars[i].close, pivot)
  const recentVol = sma(bars.map((b) => b.volume), 5)
  const volNow = last(recentVol)
  const volAvg = last(volSma)
  const dry = volNow !== null && volAvg !== null && volNow < volAvg * 0.9
  const near = Math.abs(dist) <= 4.5
  const trigger = roundPx(pivot * 1.003)
  const alreadyOut = chasedThrough(bars[i].close, trigger, aNow, bars[i].close)
  const stamp = { priorThrust60d: thrust?.rangePct }
  const vcpSketch = (): Sketch => ({
    pivot,
    box: boxFrom(bars, lastCoil.highIdx, i, "Coil"),
    levelLabel: "pivot",
    markers: [
      { time: day(bars[pivotIdx]), position: "aboveBar", shape: "arrowDown", text: "Pivot", color: MARK.pivot },
      { time: day(bars[coilLowIdx]), position: "belowBar", shape: "arrowUp", text: "Base low", color: MARK.low },
    ],
  })

  if (alreadyOut) {
    return {
      family: "VCP / Resistance Breakout",
      grade: "Developing",
      score: 47,
      entryMethod: "None — no chase",
      entryTrigger: `Pivot ~${pivot.toFixed(2)} already cleared by 0.5 ATR or 2%. Wait for a first pullback into the breakout rather than chasing.`,
      invalidation: `Failure back below the 50 EMA (~${e50.toFixed(2)}) or a messy give-back of the breakout.`,
      stop: "Not defined until a pullback low exists.",
      stopPrice: null,
      entryPrice: null,
      thesis: `Volatility contracted then price already left the pivot. Under the rules, that is not a market-order chase.`,
      plan: `Watch for a controlled pullback into the breakout/50 EMA zone before writing an order.`,
      sketch: vcpSketch(),
      ...stamp,
    }
  }

  const stopWrite = writeStructuralStop({
    structural: coilLow,
    bars,
    boxStart: lastCoil.highIdx,
    boxEnd: i,
    trigger,
    last: bars[i].close,
    atr: aNow,
    adrPct: adr,
  })
  const canCandidate = prog.ok && dry && near && Boolean(thrust?.pass) && bars[i].close > e50 && stopWrite.ok

  if (canCandidate && stopWrite.ok) {
    const stop = stopWrite.stop
    const prior = coils[coils.length - 2]
    return {
      family: "VCP / Resistance Breakout",
      grade: "Candidate",
      score: coils.length >= 3 ? 82 : 74,
      readiness: "near",
      entryMethod: "Buy Stop-Limit",
      entryTrigger: stopLimitTrigger(trigger, aNow, "the last-coil pivot"),
      invalidation: `Expansion against the position, or a breakdown of the last contraction low with volume. 50 EMA (~${e50.toFixed(2)}) is the bigger line in the sand.`,
      stop: `${stop.toFixed(2)} (below the last contraction / coil low)`,
      stopPrice: stop,
      entryPrice: trigger,
      thesis: `${coils.length} contractions (last coil ${(lastCoil.depth * 100).toFixed(1)}% vs prior ${(prior.depth * 100).toFixed(1)}%), coiled under ~${pivot.toFixed(2)} with volume drying up.`,
      plan: `${stopLimitTrigger(trigger, aNow, "the pivot")} Hard stop ${stop.toFixed(2)} under the last coil. If it rips without filling, do not chase.`,
      sketch: vcpSketch(),
      ...stamp,
    }
  }

  if (prog.ok && dry && near && Boolean(thrust?.pass) && bars[i].close > e50 && !stopWrite.ok) {
    return {
      family: "VCP / Resistance Breakout",
      grade: "Developing",
      score: 52,
      readiness: "needs_close",
      entryMethod: "None yet — stop too wide",
      entryTrigger: `Coil geometry exists but the only invalidation sits outside ${STOP_SANDWICH}. Not a Candidate.`,
      invalidation: `Base widening again, or a breakdown through the 50 EMA (~${e50.toFixed(2)}).`,
      stop: "Not a Candidate stop until a tighter coil-low invalidation exists.",
      stopPrice: null,
      entryPrice: null,
      thesis: `${coils.length} contractions, last coil ${(lastCoil.depth * 100).toFixed(1)}%. Stop rewrite still too wide.`,
      plan: `Leave it Developing. A cavern coil low is a wide base, not a Candidate VCP.`,
      sketch: vcpSketch(),
      ...stamp,
    }
  }

  return {
    family: "VCP / Resistance Breakout",
    grade: "Developing",
    score: 52,
    entryMethod: "None yet",
    entryTrigger: prog.reason
      ?? `Base is not a Candidate VCP yet (need 2+ tighter contractions, last coil 2–8% over 5–25 sessions, dry 50-day volume, stop inside ${STOP_SANDWICH}).`,
    invalidation: `Base widening again, or a breakdown through the 50 EMA (~${e50.toFixed(2)}).`,
    stop: "Not defined yet.",
    stopPrice: null,
    entryPrice: null,
    thesis: prog.reason
      ?? `Volatility is working lower and the 50 EMA is holding. Needs a tighter dry coil next to the pivot.`,
    plan: `Leave it on watch. Promote only when the last contraction is clearly tighter and a pivot trigger can be written.`,
    sketch: vcpSketch(),
    ...stamp,
  }
}

function passPlan(ema20v: number | null, ema50v: number | null, why: string[]): Candidate {
  return {
    family: "None",
    grade: "Pass",
    score: 0,
    readiness: "none",
    entryMethod: "None",
    entryTrigger: "No Core Rotation setup is defined enough to trade.",
    invalidation: "n/a",
    stop: "n/a",
    stopPrice: null,
    entryPrice: null,
    thesis: why.join(" ") || "Daily structure does not currently map to MA pullback/reclaim, bull flag/first pullback, or VCP/resistance breakout.",
    plan: `Cash is the position. 20 EMA ${ema20v ? `~${ema20v.toFixed(2)}` : "n/a"}, 50 EMA ${ema50v ? `~${ema50v.toFixed(2)}` : "n/a"}. Revisit if a cleaner Core Rotation structure appears.`,
    sketch: emptySketch(),
  }
}

function oneShareRisk(entry: number | null, stop: number | null): number | null {
  if (!entry || !stop || entry <= stop) return null
  return roundPx(entry - stop)
}

function sizeNote(equity: number | null, entry: number | null, stop: number | null): PlanOfAttack["sizing"] {
  const risk = oneShareRisk(entry, stop)
  if (risk === null) {
    return {
      equity,
      shares: null,
      dollarRisk: null,
      note: "No 1-share risk until a structural stop exists.",
    }
  }
  return {
    equity,
    shares: null,
    dollarRisk: risk,
      note: `1-share dollar risk $${risk.toFixed(2)}. Phone Grok sizes against leftover cash. Bot does not pick share count.`,
  }
}

function tapeRejects(
  lastClose: number,
  atrV: number | null,
  range: { high: number; low: number } | null,
  dollar: number | null,
  shareAdv: number | null,
  lastVol: number,
  adr: number | null,
): string[] {
  const reasons: string[] = []
  if (!(lastClose >= 5)) {
    reasons.push(`Last completed close is under $5 ($${lastClose.toFixed(2)}).`)
  }
  if (atrV !== null && lastClose > 0 && atrV / lastClose < 0.004) {
    reasons.push(`ATR too small vs price (${((atrV / lastClose) * 100).toFixed(2)}% < 0.4%). Dead tape.`)
  }
  if (range && lastClose > 0 && (range.high - range.low) / lastClose < 0.08) {
    reasons.push(`52-week range too tight (${(((range.high - range.low) / lastClose) * 100).toFixed(1)}% < 8%).`)
  }
  const thinDollar = dollar != null && dollar < 1_000_000
  const thinShares = dollar == null && shareAdv != null && shareAdv < 200_000
  if (thinDollar) {
    reasons.push(`Dollar ADV too thin ($${Math.round(dollar).toLocaleString("en-US")} < $1,000,000).`)
  } else if (thinShares) {
    reasons.push(`Average volume too thin (${Math.round(shareAdv).toLocaleString("en-US")} < 200,000).`)
  }
  if ((thinDollar || thinShares) && lastVol < 50_000) {
    reasons.push(`Last session volume is a ghost print (${Math.round(lastVol).toLocaleString("en-US")} < 50,000) with thin average.`)
  }
  if (adr != null && adr < 3) {
    reasons.push(`ADR% too small (${adr.toFixed(1)}% < 3%). Name is too slow.`)
  }
  return reasons
}

function readinessFor(chosen: Candidate): Readiness {
  if (chosen.grade === "Pass") return "none"
  if (chosen.readiness === "needs_close") return "needs_close"
  if (chosen.grade === "Developing") return "forming"
  if (chosen.grade === "Candidate") return "near"
  return "none"
}

function demoteCandidate(chosen: Candidate, scoreCap: number): Candidate {
  if (chosen.grade !== "Candidate") return chosen
  return { ...chosen, grade: "Developing", score: Math.min(chosen.score, scoreCap) }
}

export function buildPlan(pack: MarketPack): PlanOfAttack {
  const overlay = pack.daily
  const bars = completedDailyBars(pack)
  const series = bars.length ? bars : overlay
  const closes = series.map((b) => b.close)
  const highs = series.map((b) => b.high)
  const lows = series.map((b) => b.low)
  const volumes = series.map((b) => b.volume)
  const overlayCloses = overlay.map((b) => b.close)
  const ema20Series = ema(closes, 20)
  const ema50Series = ema(closes, 50)
  const overlayEma20 = overlay.length === series.length ? ema20Series : ema(overlayCloses, 20)
  const overlayEma50 = overlay.length === series.length ? ema50Series : ema(overlayCloses, 50)
  const rsi14 = rsi(closes, 14)
  const atr14 = atr(highs, lows, closes, 14)
  const volSma50 = sma(volumes, 50)
  const volSma20 = sma(volumes, 20)
  const ema20v = last(ema20Series)
  const ema50v = last(ema50Series)
  const rsiV = last(rsi14)
  const atrV = last(atr14)
  const avgVol = last(volSma50) ?? last(volSma20) ?? pack.fundamentals.avgVolume
  const lastVol = series[series.length - 1]?.volume ?? 0
  const relVol = avgVol && lastVol ? lastVol / avgVol : null
  const weeklyTrend = weeklyStageFrom(pack.weekly)
  const completedClose = closes[closes.length - 1] ?? pack.quote.last
  const lastPrice = pack.quote.last > 0 ? pack.quote.last : completedClose
  const completedDate = series[series.length - 1] ? day(series[series.length - 1]) : null
  const overlayDate = overlay[overlay.length - 1] ? day(overlay[overlay.length - 1]) : null
  const liveOverlay = Boolean(completedDate && overlayDate && overlayDate !== completedDate)
  const previousClose = liveOverlay
    ? completedClose
    : (pack.quote.previousClose || closes[closes.length - 2] || completedClose)
  const changePct = pct(previousClose, lastPrice)
  const earnDays = daysUntil(pack.earningsDate)
  const warnings: string[] = []
  const thrustFloor = finalistConfig().priorThrustPct
  const thrust = priorThrust60d(closes, thrustFloor)
  const adr = adrPct(series)
  const dollar = dollarAdv(series, 50)
  const rng = range52(series)
  const high52 = rng?.high ?? pack.fundamentals.high52
  const low52 = rng?.low ?? pack.fundamentals.low52
  const template = trendTemplate(closes, completedClose, high52, low52)
  const rs = rsRaw(closes)
  const spyBeat = beatsSpy(closes, pack.spyCloses, 63)
  const legs = thrustLegCount(closes)

  let chosen: Candidate
  const banned = bannedInstrument(pack.instrument?.type, pack.name, pack.ticker)
  if (banned) {
    const why = [`${pack.ticker} is not a common stock (${pack.instrument?.type || pack.name || "instrument"}).`]
    chosen = passPlan(ema20v, ema50v, why)
    warnings.push(...why)
  } else {
    const tape = tapeRejects(completedClose, atrV, rng ?? (high52 != null && low52 != null ? { high: high52, low: low52 } : null), dollar, avgVol, lastVol, adr)
    if (tape.length) {
      chosen = passPlan(ema20v, ema50v, tape)
      warnings.push(...tape)
    } else if (!template.pass) {
      chosen = passPlan(ema20v, ema50v, template.reasons)
      warnings.push(...template.reasons)
    } else {
      const candidates = [
        detectMaPullback(series, ema20Series, ema50Series, atr14, volSma20, weeklyTrend, thrust, adr),
        detectFlag(series, ema20Series, ema50Series, atr14, volSma50, thrust, adr),
        detectVcp(series, ema50Series, atr14, volSma50, thrust, adr),
      ].filter((c): c is Candidate => Boolean(c))

      candidates.sort((a, b) => b.score - a.score)
      chosen = candidates[0] ?? passPlan(ema20v, ema50v, [
        weeklyTrend === "down" ? "Weekly 30-week stage is not supportive." : "No Core Rotation pattern cleared the quality bar.",
      ])

      if (weeklyTrend === "down" && chosen.grade !== "Pass") {
        warnings.push("Weekly 30-week stage is down. Daily setup is capped at Developing — cannot stay Candidate against weekly structure.")
        chosen = demoteCandidate(chosen, 58)
      } else if (weeklyTrend === "sideways" && chosen.grade === "Candidate") {
        warnings.push("Weekly 30-week is not rising. Daily setup is capped at Developing.")
        chosen = demoteCandidate(chosen, 58)
      }

      if (earnDays !== null && earnDays <= 5 && chosen.grade !== "Pass") {
        warnings.push(`Earnings ${pack.earningsDate} (~${earnDays} day${earnDays === 1 ? "" : "s"}). Do not hold through earnings. Cannot stay Candidate.`)
        chosen = demoteCandidate(chosen, 55)
      }

      if (chosen.grade === "Candidate" && rs == null) {
        warnings.push("No scan-RS (need 252 completed sessions). Geometry cannot stay Candidate.")
        chosen = demoteCandidate(chosen, 58)
      } else if (chosen.grade === "Candidate" && spyBeat === false) {
        warnings.push("Does not beat SPY over 63 sessions. Geometry cannot stay Candidate.")
        chosen = demoteCandidate(chosen, 58)
      }

      if (legs >= 3 && chosen.grade !== "Pass") {
        warnings.push("Late-stage: 3+ 20% thrust legs in 12 months. Score haircut, not a Pass.")
        chosen = { ...chosen, score: Math.max(0, chosen.score - 12) }
      }

      if (relVol !== null && relVol > 3 && chosen.family.includes("Pullback") && chosen.grade === "Candidate") {
        warnings.push("Relative volume is very high today — make sure this is still a controlled pullback, not a disorderly event.")
      }
    }
  }

  const chart = overlay.slice(-180)
  const risk = oneShareRisk(chosen.entryPrice, chosen.stopPrice)
  const book = readActiveAccount()
  const sized = sizeFromAccount(book, chosen.entryPrice, chosen.stopPrice)
  if (sized && !sized.sizeableNow && chosen.grade !== "Pass") {
    warnings.push(`Cannot take 1 share on the live book at 1%/6% (equity ${book.equity != null ? `$${book.equity.toFixed(2)}` : "n/a"}). Phone still sees the name; leftover cash is Phone's filter, not a dock drop.`)
  }
  const targets = rTargets(chosen.entryPrice, chosen.stopPrice)
  const namedLevel = chosen.entryPrice ?? chosen.sketch.pivot
  const namedLabel = chosen.entryPrice ? "trigger" : chosen.sketch.levelLabel
  const gap = namedLevel && namedLabel ? describeGap(lastPrice, namedLevel, atrV, namedLabel) : null
  const caption = chosen.grade === "Pass"
    ? (chosen.thesis.split(/(?<=\.)\s/)[0] || "No Core Rotation setup")
    : gap?.text ?? null

  return {
    ticker: pack.ticker,
    name: pack.name,
    grade: chosen.grade,
    score: chosen.score,
    setupType: chosen.family,
    lastPrice,
    previousClose,
    changePct,
    weeklyTrend,
    readiness: readinessFor(chosen),
    oneShareRisk: risk,
    earnDays,
    entryMethod: chosen.entryMethod,
    entryTrigger: chosen.entryTrigger,
    invalidation: chosen.invalidation,
    stop: chosen.stop,
    thesis: chosen.thesis,
    plan: chosen.plan,
    earnings: pack.earningsDate
      ? `Next report ${pack.earningsDate}${earnDays !== null ? ` (${earnDays}d)` : ""}.`
      : "No upcoming earnings date from Robinhood.",
    warnings,
    entryPrice: chosen.entryPrice,
    stopPrice: chosen.stopPrice,
    pivot: chosen.sketch.pivot,
    r1: targets.r1,
    r2: targets.r2,
    r3: targets.r3,
    levels: {
      ema20: ema20v,
      ema50: ema50v,
      sma50: template.sma50,
      sma150: template.sma150,
      sma200: template.sma200,
      rsi14: rsiV,
      atr14: atrV,
      adrPct: adr,
      high52,
      low52,
      avgVolume: avgVol,
      relativeVolume: relVol,
    },
    sizing: sizeNote(pack.equity, chosen.entryPrice, chosen.stopPrice),
    geometry: clipGeometry(chart, chosen.sketch, caption, gap),
    chart,
    ema20Series: overlayEma20.slice(-180),
    ema50Series: overlayEma50.slice(-180),
    analyzedAt: nowPtStamp(),
    priorThrust60d: chosen.priorThrust60d ?? thrust?.rangePct,
    stopAtrMultiple: risk != null && atrV ? risk / atrV : undefined,
    stopPct: risk != null && lastPrice > 0 ? (risk / lastPrice) * 100 : undefined,
    flagRetracePct: chosen.flagRetracePct,
    dollarAdv: dollar ?? (avgVol != null && completedClose > 0 ? avgVol * completedClose : undefined),
    rsRaw: rs,
    scanRs: null,
    spyBeat,
    sector: pack.fundamentals.sector,
    industry: pack.fundamentals.industry,
  }
}
