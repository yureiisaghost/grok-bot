import type { OhlcvBar, PlanOfAttack } from "../src/types"
import { qualityScore, rejectReason, selectFinalists, tallyLine } from "./finalists"
import { priorThrust60d } from "./thrust"

function rampCloses(start: number, end: number, n: number) {
  return Array.from({ length: n }, (_, i) => start + (end - start) * (i / Math.max(1, n - 1)))
}

function barsFromCloses(closes: number[], volume = 2_000_000): OhlcvBar[] {
  return closes.map((close, i) => ({
    time: `2026-${String(i + 1).padStart(3, "0")}`,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume,
  }))
}

const rallyBars = barsFromCloses(rampCloses(20, 25, 60))
const roundTripCloses = [...rampCloses(100, 125, 30), ...rampCloses(125, 100, 30)]
const roundTripBars = barsFromCloses(roundTripCloses)

function base(over: Partial<PlanOfAttack> = {}): PlanOfAttack {
  return {
    ticker: "TEST",
    name: "Test",
    grade: "Candidate",
    score: 80,
    setupType: "Bull Flag / First Pullback after Impulse",
    lastPrice: 25,
    previousClose: 24.5,
    changePct: 2,
    weeklyTrend: "up",
    readiness: "near",
    oneShareRisk: 1.2,
    earnDays: 40,
    entryMethod: "Stop-Limit",
    entryTrigger: "x",
    invalidation: "x",
    stop: "x",
    thesis: "x",
    plan: "x",
    earnings: "x",
    warnings: [],
    entryPrice: 25.2,
    stopPrice: 24,
    pivot: 25,
    r1: 26.4,
    r2: 27.6,
    r3: 28.8,
    levels: {
      ema20: 24,
      ema50: 23,
      sma50: 24,
      sma150: 22,
      sma200: 21,
      rsi14: 55,
      atr14: 0.8,
      adrPct: 4,
      high52: 40,
      low52: 15,
      avgVolume: 1_500_000,
      relativeVolume: 1.1,
    },
    sizing: { equity: null, shares: null, dollarRisk: 1.2, note: "1-share" },
    geometry: {
      box: null,
      markers: [],
      caption: "0.3 ATR under trigger",
      pctToLevel: 0.8,
      atrToLevel: 0.25,
      levelLabel: "trigger",
    },
    chart: rallyBars,
    ema20Series: rallyBars.map((b) => b.close * 0.98),
    ema50Series: rallyBars.map((b) => b.close * 0.92),
    analyzedAt: "now",
    flagRetracePct: 30,
    ...over,
  }
}

function maCard(ticker: string): PlanOfAttack {
  return base({
    ticker,
    setupType: "MA Pullback / Key Level Reclaim",
    thesis: "Price probed the rising 20 EMA and closed back above. Reclaim printed.",
    entryTrigger: "After the reclaim at the 20 EMA, Stop-Limit just above 25.20.",
    lastPrice: 25,
    entryPrice: 25.2,
    stopPrice: 24.2,
    oneShareRisk: 1.0,
    flagRetracePct: undefined,
    geometry: { ...base().geometry, atrToLevel: 0.1, pctToLevel: 0.8 },
    levels: { ...base().levels, atr14: 1.0, high52: 26, ema20: 24.6, ema50: 23.4, avgVolume: 4_000_000 },
  })
}

function flagCard(ticker: string): PlanOfAttack {
  return base({
    ticker,
    setupType: "Bull Flag / First Pullback after Impulse",
    flagRetracePct: 45,
    lastPrice: 25,
    entryPrice: 25.2,
    stopPrice: 24,
    oneShareRisk: 1.2,
    geometry: { ...base().geometry, atrToLevel: 0.45, pctToLevel: 0.8 },
    levels: { ...base().levels, atr14: 0.9, high52: 42, avgVolume: 1_500_000 },
  })
}

const cases: Array<[string, PlanOfAttack, string | null]> = [
  ["keep near", base(), null],
  ["drop developing", base({ grade: "Developing", readiness: "forming" }), "not_candidate"],
  ["drop forming candidate", base({ readiness: "forming" }), "not_near"],
  ["drop needs_close", base({ readiness: "needs_close" }), "not_near"],
  ["drop weekly down", base({ weeklyTrend: "down" }), "weekly_down"],
  ["drop earnings 14d", base({ earnDays: 14 }), "earnings"],
  ["keep earnings 16d", base({ earnDays: 16 }), null],
  ["keep missing earnings", base({ earnDays: null }), null],
  ["drop no risk", base({ oneShareRisk: null, sizing: { equity: null, shares: null, dollarRisk: null, note: "" } }), "risk_missing"],
  ["keep $6 risk (old $5 cap retired)", base({
    lastPrice: 80,
    entryPrice: 80.5,
    stopPrice: 74.5,
    oneShareRisk: 6,
    levels: { ...base().levels, atr14: 5, ema20: 75, ema50: 70, high52: 90, low52: 40 },
    chart: barsFromCloses(rampCloses(64, 80, 60)),
    geometry: { ...base().geometry, atrToLevel: 0.1, pctToLevel: 0.6 },
  }), null],
  ["drop risk vs atr floor", base({ oneShareRisk: 0.1, levels: { ...base().levels, atr14: 0.8 } }), "risk_vs_atr"],
  ["drop risk vs atr ceiling", base({ oneShareRisk: 1.3, levels: { ...base().levels, atr14: 0.8 } }), "risk_vs_atr_high"],
  ["drop stop too wide pct", base({
    lastPrice: 10,
    entryPrice: 10.1,
    stopPrice: 8.9,
    oneShareRisk: 1.2,
    levels: { ...base().levels, atr14: 1.2, ema50: 8, ema20: 9 },
  }), "stop_too_wide_pct"],
  ["drop ma stop too wide pct", base({
    setupType: "MA Pullback / Key Level Reclaim",
    lastPrice: 26.31,
    entryPrice: 27.0,
    stopPrice: 22.9,
    oneShareRisk: 4.1,
    flagRetracePct: undefined,
    levels: { ...base().levels, atr14: 3.0, ema50: 20, ema20: 24 },
    geometry: { ...base().geometry, atrToLevel: 0.2, pctToLevel: 2.6 },
  }), "stop_too_wide_pct"],
  ["drop no prior thrust round-trip", base({ chart: roundTripBars, lastPrice: 100, levels: { ...base().levels, ema50: 90, atr14: 2 } }), "no_prior_thrust"],
  ["drop below 50", base({ lastPrice: 20, levels: { ...base().levels, ema50: 22 } }), "below_50"],
  ["drop flag too deep", base({ flagRetracePct: 55 }), "flag_too_deep"],
  ["drop too far under atr", base({ geometry: { ...base().geometry, atrToLevel: 1.5 } }), "too_far_under"],
  ["keep 1.49 under", base({ geometry: { ...base().geometry, atrToLevel: 1.49 } }), null],
  ["keep at trigger", base({ lastPrice: 25.2, geometry: { ...base().geometry, atrToLevel: 0, pctToLevel: 0 } }), null],
  ["keep 0.5 atr through", base({ geometry: { ...base().geometry, atrToLevel: -0.5 } }), null],
  ["drop chase 0.51 atr through", base({ geometry: { ...base().geometry, atrToLevel: -0.51 } }), "chase_through"],
  ["drop 10% under no atr", base({
    levels: { ...base().levels, atr14: null },
    geometry: { ...base().geometry, atrToLevel: null, pctToLevel: 10 },
  }), "too_far_under"],
  ["drop 1.1% through no atr", base({
    levels: { ...base().levels, atr14: null },
    geometry: { ...base().geometry, atrToLevel: null, pctToLevel: -1.1 },
  }), "chase_through"],
  ["drop dead tape vol", base({ levels: { ...base().levels, avgVolume: 20_000 }, dollarAdv: undefined }), "dead_tape"],
  ["keep expensive thin-share tape", base({
    lastPrice: 80,
    previousClose: 79,
    entryPrice: 80.4,
    stopPrice: 78.4,
    oneShareRisk: 2.0,
    r1: 82.4,
    r2: 84.4,
    r3: 86.4,
    dollarAdv: 4_000_000,
    levels: { ...base().levels, avgVolume: 50_000, atr14: 2.4, ema20: 78, ema50: 74 },
    geometry: { ...base().geometry, atrToLevel: 0.17, pctToLevel: 0.5 },
  }), null],
  ["ma skips thrust gate", base({
    setupType: "MA Pullback / Key Level Reclaim",
    chart: roundTripBars,
    lastPrice: 25,
    flagRetracePct: undefined,
  }), null],
  ["flag with tight stop may dock", base({
    ticker: "TIGHT",
    lastPrice: 25,
    entryPrice: 25.2,
    stopPrice: 24.1,
    oneShareRisk: 1.1,
    flagRetracePct: 28,
    levels: { ...base().levels, atr14: 0.9, avgVolume: 2_000_000 },
    geometry: { ...base().geometry, atrToLevel: 0.2 },
  }), null],
  ["illiquid at size when both exist", base({
    plannedSharesAtRoom: 10_000,
    dollarAdv: 1_000_000,
    entryPrice: 25.2,
  }), "illiquid_at_size"],
  ["skip illiquid if no planned notional", base({ dollarAdv: 5_000_000 }), null],
]

let failed = 0
for (const [name, plan, expect] of cases) {
  const got = rejectReason(plan)
  if (got !== expect) {
    failed += 1
    console.error(`FAIL ${name}: got ${got} expected ${expect}`)
  }
}

const cheap = base({
  ticker: "CHEAP",
  oneShareRisk: 0.4,
  flagRetracePct: 48,
  geometry: { ...base().geometry, atrToLevel: 1.2 },
  levels: { ...base().levels, avgVolume: 250_000 },
})
const clean = base({
  ticker: "CLEAN",
  oneShareRisk: 1.05,
  flagRetracePct: 28,
  geometry: { ...base().geometry, atrToLevel: 0.15 },
  levels: { ...base().levels, avgVolume: 4_000_000 },
})
if (qualityScore(clean) <= qualityScore(cheap)) {
  failed += 1
  console.error(`FAIL quality fixtures: clean ${qualityScore(clean)} cheap ${qualityScore(cheap)}`)
}

const sorted = selectFinalists([cheap, clean])
const order = sorted.finalists.map((p) => p.ticker).join(",")
if (order !== "CLEAN,CHEAP") {
  failed += 1
  console.error(`FAIL sort (cheaper stop must lose): ${order}`)
}

const stamped = selectFinalists([
  base({ ticker: "KEEP" }),
  base({ ticker: "DEV", grade: "Developing", readiness: "forming" }),
])
const keep = stamped.warehouse.find((p) => p.ticker === "KEEP")
const dev = stamped.warehouse.find((p) => p.ticker === "DEV")
if (!keep || keep.failedGates?.length !== 0 || keep.qualityScore == null) {
  failed += 1
  console.error("FAIL warehouse survivor stamp")
}
if (!dev || dev.failedGates?.[0] !== "not_candidate") {
  failed += 1
  console.error("FAIL warehouse reject failedGates")
}

const empty = selectFinalists([base({ ticker: "X", grade: "Developing", readiness: "forming" })])
if (empty.finalists.length !== 0 || empty.rawCount !== 1) {
  failed += 1
  console.error("FAIL zero survivors")
}

const many = selectFinalists(Array.from({ length: 21 }, (_, i) => base({ ticker: `T${String(i).padStart(2, "0")}` })))
if (many.finalists.length !== 21) {
  failed += 1
  console.error(`FAIL no dock cap: expected 21, got ${many.finalists.length}`)
}

const mix = selectFinalists([
  ...Array.from({ length: 11 }, (_, i) => maCard(`M${String(i).padStart(2, "0")}`)),
  ...Array.from({ length: 3 }, (_, i) => flagCard(`F${String(i).padStart(2, "0")}`)),
])
const mixMa = mix.finalists.filter((p) => p.setupType.startsWith("MA")).length
const mixFlag = mix.finalists.filter((p) => p.setupType.startsWith("Bull Flag")).length
if (mixMa !== 11 || mixFlag !== 3) {
  failed += 1
  console.error(`FAIL full mix: MA ${mixMa} Flag ${mixFlag} dock ${mix.finalists.map((p) => p.ticker).join(",")}`)
}
const line = tallyLine(mix)
if (!/Landed MA 11, Flag 3, VCP 0/.test(line) || /Mix cap/.test(line) || /Capped off dock/.test(line)) {
  failed += 1
  console.error(`FAIL uncapped tally: ${line}`)
}
const mixOn = mix.warehouse.find((p) => p.ticker === mix.finalists[0]?.ticker)
if (mixOn && mixOn.failedGates?.length) {
  failed += 1
  console.error("FAIL dock survivor should have empty failedGates", mixOn.ticker, mixOn.failedGates)
}
const mixCapped = mix.warehouse.filter((p) => p.failedGates?.[0] === "mix_cap" || p.failedGates?.[0] === "dock_capped")
if (mixCapped.length !== 0) {
  failed += 1
  console.error(`FAIL no mix/dock cap stamps: ${mixCapped.length}`)
}

const wideStop = qualityScore(base({
  lastPrice: 25,
  entryPrice: 25.2,
  stopPrice: 23.1,
  oneShareRisk: 2.1,
  stopPct: 8.4,
  levels: { ...base().levels, atr14: 1.6 },
}))
const tightStop = qualityScore(base({
  lastPrice: 25,
  entryPrice: 25.2,
  stopPrice: 24.2,
  oneShareRisk: 1.0,
  stopPct: 4,
  levels: { ...base().levels, atr14: 1.0 },
}))
if (wideStop >= tightStop) {
  failed += 1
  console.error(`FAIL stopPct penalty: wide ${wideStop} tight ${tightStop}`)
}

const tsco = qualityScore(base({
  lastPrice: 20,
  levels: { ...base().levels, high52: 40, ema20: 19, ema50: 18 },
}))
const nearHigh = qualityScore(base({
  lastPrice: 24,
  levels: { ...base().levels, high52: 26, ema20: 23, ema50: 22 },
}))
if (tsco >= nearHigh) {
  failed += 1
  console.error(`FAIL ma52 25% under cap: tsco ${tsco} near ${nearHigh}`)
}

const up = priorThrust60d(rampCloses(100, 125, 60), 20)
if (!up || !up.pass || Math.abs(up.rangePct - 25) > 0.01 || !up.lastInUpperHalf) {
  failed += 1
  console.error("FAIL thrust clean 25% advance", up)
}
const down = priorThrust60d(roundTripCloses, 20)
if (!down || down.pass || down.lastInUpperHalf || Math.abs(down.rangePct - 25) > 0.2) {
  failed += 1
  console.error("FAIL thrust must fail on box sitting on lows", down)
}
if (priorThrust60d(rampCloses(100, 125, 59), 20) !== null) {
  failed += 1
  console.error("FAIL thrust <60 bars must be null")
}

if (failed) {
  console.error(`${failed} failed`)
  process.exit(1)
}
console.log(`ok ${cases.length} reject cases + sort + full dock + penalties + thrust + warehouse stamps`)
