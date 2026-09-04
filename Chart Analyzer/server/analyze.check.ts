import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { buildPlan } from "./analyze"
import { rejectReason, selectFinalists } from "./finalists"
import type { MarketPack } from "./market"
import { atr, ema, last } from "./indicators"
import { lastHigherLow, writeStructuralStop } from "./stopWriter"
import { priorThrust60d } from "./thrust"
import { isCheapCsvPrice, rowsFromCsvText } from "./csv"
import type { OhlcvBar } from "../src/types"

const here = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.resolve(here, "..", ".bridge", "cache")
const scan4Path = path.resolve(here, "..", "..", "Grok Bot", "Potential Trades", "2026-08-27_scan-4.json")
const named = ["RNW", "ENGS", "UROY", "BGC", "TRX", "CMPX", "INO", "RITM"] as const

let failed = 0
const skipped: string[] = []
const notes: string[] = []

function ramp(start: number, end: number, n: number) {
  return Array.from({ length: n }, (_, i) => start + (end - start) * (i / Math.max(1, n - 1)))
}

function candle(i: number, open: number, high: number, low: number, close: number, volume = 2_000_000): OhlcvBar {
  const t = new Date(Date.UTC(2025, 0, 2 + i)).toISOString().slice(0, 10)
  return {
    time: t,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
    volume,
  }
}

function reindexDates(bars: OhlcvBar[]): OhlcvBar[] {
  return bars.map((b, i) => ({
    ...b,
    time: new Date(Date.UTC(2024, 0, 2 + i)).toISOString().slice(0, 10),
  }))
}

/** Prepend a rising 230-day lead-in so SMA 50/150/200, scan-RS, and 30-week stage can pass. */
function padHistory(shape: OhlcvBar[], padN = 230): OhlcvBar[] {
  if (!shape.length) return shape
  const first = shape[0]
  const startPx = Math.max(6, first.close * 0.55)
  const vol = first.volume || 2_000_000
  const pad = Array.from({ length: padN }, (_, i) => {
    const close = startPx + (first.close - startPx) * (i / Math.max(1, padN - 1))
    return candle(i, close * 0.998, close * 1.02, close * 0.98, close, vol)
  })
  return reindexDates([...pad, ...shape])
}

function packFrom(ticker: string, dailyIn: OhlcvBar[]): MarketPack {
  const daily = padHistory(dailyIn)
  const last = daily[daily.length - 1]
  const prev = daily[daily.length - 2] ?? last
  const weekly: OhlcvBar[] = []
  for (let i = 4; i < daily.length; i += 5) {
    const slice = daily.slice(i - 4, i + 1)
    weekly.push({
      time: slice[slice.length - 1].time,
      open: slice[0].open,
      high: Math.max(...slice.map((b) => b.high)),
      low: Math.min(...slice.map((b) => b.low)),
      close: slice[slice.length - 1].close,
      volume: slice.reduce((a, b) => a + b.volume, 0),
    })
  }
  const spyCloses = daily.map((_, i) => 100 + (8 * i) / Math.max(1, daily.length - 1))
  return {
    ticker,
    name: ticker,
    quote: { last: last.close, previousClose: prev.close, bid: null, ask: null },
    fundamentals: {
      high52: Math.max(...daily.map((b) => b.high)),
      low52: Math.min(...daily.map((b) => b.low)),
      marketCap: 2_000_000_000,
      float: null,
      avgVolume: 2_000_000,
      avgVolume2Weeks: 2_000_000,
      pe: null,
      sector: null,
      industry: null,
      description: null,
    },
    spyCloses,
    daily,
    weekly,
    earningsDate: "2026-12-15",
    equity: null,
  }
}

function trend(n: number, start: number, end: number, vol = 2_000_000): OhlcvBar[] {
  return Array.from({ length: n }, (_, i) => {
    const close = start + (end - start) * (i / Math.max(1, n - 1))
    return candle(i, close * 0.998, close * 1.02, close * 0.98, close, vol)
  })
}

const up = priorThrust60d(ramp(100, 125, 60), 20)
if (!up?.pass || Math.abs(up.rangePct - 25) > 0.05) {
  failed += 1
  console.error("FAIL analyze-check thrust pass", up)
}
const box = priorThrust60d([...ramp(100, 125, 30), ...ramp(125, 100, 30)], 20)
if (!box || box.pass || box.lastInUpperHalf) {
  failed += 1
  console.error("FAIL analyze-check thrust fail on lows", box)
}

const tightBars = trend(20, 20, 25)
const tightWrite = writeStructuralStop({
  structural: 24,
  bars: tightBars,
  boxStart: 12,
  boxEnd: 19,
  trigger: 25.2,
  last: 25,
  atr: 1.0,
})
if (!tightWrite.ok) {
  failed += 1
  console.error("FAIL stop writer tight 4% should Candidate", tightWrite)
}

const cavernBars = [
  ...trend(12, 20, 25),
  ...Array.from({ length: 8 }, (_, i) => candle(12 + i, 24.8, 25.1, 21.8, 24.9, 1_200_000)),
]
const cavern = writeStructuralStop({
  structural: 21.8,
  bars: cavernBars,
  boxStart: 12,
  boxEnd: cavernBars.length - 1,
  trigger: 25.2,
  last: 24.9,
  atr: (25.2 - 21.8) / 2,
})
if (cavern.ok || cavern.reason !== "too_wide") {
  failed += 1
  console.error("FAIL stop writer 12%/2ATR should be too_wide", cavern)
}

const hlBars = [
  candle(0, 11, 12, 11, 11.5),
  candle(1, 13, 14, 13, 13.5),
  candle(2, 12, 13, 12, 12.5),
]
const hl = lastHigherLow(hlBars, 0, 2, 10)
if (hl !== 12) {
  failed += 1
  console.error("FAIL lastHigherLow is most recent higher low, not the max", hl)
}

function umacShape(): OhlcvBar[] {
  const bars = trend(90, 18, 35, 2_200_000)
  const crash = [32, 29, 26, 24, 23, 23.4, 24.2, 25.1, 25.8, 26.1]
  return [
    ...bars.slice(0, -crash.length),
    ...crash.map((close, i) => {
      const idx = bars.length - crash.length + i
      const prev = i === 0 ? 35 : crash[i - 1]
      return candle(idx, prev, Math.max(prev, close) * 1.02, Math.min(prev, close) * 0.97, close, 3_500_000)
    }),
  ]
}

function seriesStats(bars: OhlcvBar[]) {
  const closes = bars.map((b) => b.close)
  const e20 = ema(closes, 20)
  const a14 = atr(bars.map((b) => b.high), bars.map((b) => b.low), closes, 14)
  return { e20: last(e20)!, a14: last(a14)!, e20Prev: e20[e20.length - 2]!, e20Series: e20 }
}

function neogCoil(): OhlcvBar[] {
  const bars = Array.from({ length: 90 }, (_, i) => {
    const close = 9 + i * 0.025
    return candle(i, close, close * 1.01, close * 0.993, close, 1_800_000)
  })
  for (let k = 0; k < 14; k++) {
    const s = seriesStats(bars)
    const close = s.e20 * 1.004
    bars.push(candle(bars.length, close, close + Math.max(s.a14, close * 0.006) * 0.9, s.e20 * 0.998, close, 1_400_000))
  }
  return bars
}

function cleanReclaim(): OhlcvBar[] {
  const bars = trend(80, 20, 28, 2_200_000)
  for (let k = 0; k < 18; k++) {
    const s = seriesStats(bars)
    const close = s.e20 * 1.025
    bars.push(candle(bars.length, close * 0.998, close * 1.03, s.e20 * 1.015, close, 2_000_000))
  }
  const s = seriesStats(bars)
  const underClose = s.e20 * 0.99
  const underLow = s.e20 - Math.max(s.a14, s.e20 * 0.025) * 0.45
  bars.push(candle(bars.length, s.e20, s.e20 * 1.002, underLow, underClose, 1_600_000))
  const n = seriesStats(bars)
  const rec = Math.max(n.e20, n.e20Prev) * 1.008
  bars.push(candle(bars.length, rec * 0.993, rec * 1.01, n.e20 * 0.996, rec, 2_100_000))
  return bars
}

function tightFlag(): OhlcvBar[] {
  const body = trend(90, 18, 28, 1_800_000)
  const pole = Array.from({ length: 8 }, (_, i) => {
    const close = 28 + (i + 1) * 0.7
    return candle(body.length + i, close - 0.4, close + 0.25, close - 0.55, close, 4_000_000)
  })
  const poleHigh = pole[pole.length - 1].close
  const flag = Array.from({ length: 8 }, (_, i) => {
    const low = poleHigh - 1.1 + i * 0.08
    const close = poleHigh - 0.35 + i * 0.02
    return candle(body.length + pole.length + i, close + 0.05, Math.max(close, poleHigh - 0.05), low, close, 1_400_000)
  })
  return [...body, ...pole, ...flag]
}

function wideFlag(): OhlcvBar[] {
  const body = trend(90, 18, 28, 1_800_000)
  const pole = Array.from({ length: 8 }, (_, i) => {
    const close = 28 + (i + 1) * 0.7
    return candle(body.length + i, close - 0.4, close + 0.25, close - 0.55, close, 4_000_000)
  })
  const poleHigh = pole[pole.length - 1].close
  const flag = Array.from({ length: 8 }, (_, i) => {
    const close = poleHigh - 0.4
    return candle(body.length + pole.length + i, close + 0.1, poleHigh - 0.05, poleHigh - 4.0, close, 1_400_000)
  })
  return [...body, ...pole, ...flag]
}

function checkPlan(name: string, plan: ReturnType<typeof buildPlan>, want: (p: typeof plan) => boolean, detail: string) {
  const reason = rejectReason(plan)
  const line = `${name} grade=${plan.grade} ready=${plan.readiness} family=${plan.setupType} stop=${plan.stopPrice} reject=${reason}`
  notes.push(line)
  console.log(line)
  if (!want(plan)) {
    failed += 1
    console.error(`FAIL ${name}: ${detail}`)
  }
}

const umacPlan = buildPlan(packFrom("UMACX", umacShape()))
checkPlan(
  "UMAC-shape",
  umacPlan,
  (p) => !(p.grade === "Candidate" && rejectReason(p) == null),
  "smash-bounce 15% MA must not dock as Candidate",
)

const neogPlan = buildPlan(packFrom("NEOGX", neogCoil()))
checkPlan(
  "NEOG-shape",
  neogPlan,
  (p) => p.grade !== "Candidate",
  "coil on the 20 with no 1-ATR probe / reclaim must be Developing",
)

const reclaimPlan = buildPlan(packFrom("CLEANR", cleanReclaim()))
checkPlan(
  "clean reclaim",
  reclaimPlan,
  (p) => {
    const reason = rejectReason(p)
    const stopPct = p.lastPrice > 0 && p.entryPrice != null && p.stopPrice != null
      ? (p.entryPrice - p.stopPrice) / p.lastPrice
      : 99
    return p.grade === "Candidate" && p.readiness === "near" && reason == null && stopPct <= 0.10
  },
  "clean MA reclaim with a 4-ish % stop should Candidate and dock",
)

const flagTightPlan = buildPlan(packFrom("FLGHT", tightFlag()))
checkPlan(
  "tight flag",
  flagTightPlan,
  (p) => {
    const reason = rejectReason(p)
    if (p.setupType.startsWith("Bull Flag") && p.grade === "Candidate") return reason == null
    return true
  },
  "tight rewritten flag stop may dock; must not die only for being Flag",
)

const flagWidePlan = buildPlan(packFrom("FLWID", wideFlag()))
checkPlan(
  "wide flag",
  flagWidePlan,
  (p) => p.grade !== "Candidate" || rejectReason(p) != null,
  "flag whose only invalidation is still 12% / 2 ATR must not dock",
)

const csvRows = rowsFromCsvText("Symbol,Price\nAAA,12.5\nBBB,4.50\nCCC,\n")
if (csvRows.length !== 3 || csvRows[0].price !== 12.5 || csvRows[1].price !== 4.5 || csvRows[2].price !== null) {
  failed += 1
  console.error("FAIL csv price parse", csvRows)
}
if (!isCheapCsvPrice(csvRows[1]) || isCheapCsvPrice(csvRows[0]) || isCheapCsvPrice(csvRows[2])) {
  failed += 1
  console.error("FAIL cheap csv price gate")
}
const noPrice = rowsFromCsvText("Symbol,Name\nDDD,Foo\n")
if (noPrice[0]?.price != null || isCheapCsvPrice(noPrice[0]!)) {
  failed += 1
  console.error("FAIL no price column must not skip")
}

function loadPack(ticker: string): MarketPack | null {
  const file = path.join(cacheDir, `${ticker}.json`)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MarketPack
  } catch {
    return null
  }
}

for (const ticker of named) {
  const pack = loadPack(ticker)
  if (!pack?.daily?.length) {
    skipped.push(ticker)
    notes.push(`${ticker}: cache bars missing`)
    continue
  }
  const plan = buildPlan(pack)
  const reason = rejectReason(plan)
  const line = `${ticker} grade=${plan.grade} ready=${plan.readiness} family=${plan.setupType} earn=${plan.earnDays} thrust=${plan.priorThrust60d?.toFixed(1)} reject=${reason}`
  notes.push(line)
  console.log(line)

  const offDock = plan.grade !== "Candidate" || plan.readiness !== "near" || reason != null

  if (ticker === "RNW" && plan.grade === "Candidate" && reason == null) {
    failed += 1
    console.error("FAIL RNW still a dock Candidate (want dead-tape or no VCP contractions)")
  }
  if (ticker === "ENGS" && plan.grade === "Candidate" && plan.readiness === "near") {
    failed += 1
    console.error("FAIL ENGS still Candidate+near (want smash / not-reclaim)")
  }
  if (ticker === "RITM" && plan.grade === "Candidate" && plan.entryMethod === "Limit") {
    failed += 1
    console.error("FAIL RITM still a falling-20 limit Candidate")
  }
  if (ticker === "RITM" && plan.grade === "Candidate" && plan.readiness === "near") {
    failed += 1
    console.error("FAIL RITM still Candidate+near")
  }
  if (ticker === "BGC" && plan.grade === "Candidate") {
    failed += 1
    console.error("FAIL BGC still Candidate (4-day pause is not a flag)")
  }
  if (ticker === "TRX" && plan.grade === "Candidate" && reason == null) {
    failed += 1
    console.error("FAIL TRX still dock Candidate (want pole-or-thrust fail)")
  }
  if (ticker === "UROY") {
    const earnFail = plan.earnDays != null && plan.earnDays <= 15 && (reason === "earnings" || offDock)
    if (plan.grade === "Candidate" && plan.readiness === "near" && reason !== "earnings") {
      failed += 1
      console.error(`FAIL UROY should fail earnings window, got ${reason}`)
    }
    if (!earnFail && plan.grade === "Candidate" && reason == null) {
      failed += 1
      console.error("FAIL UROY still on dock")
    }
  }
  if (ticker === "INO" && plan.grade === "Candidate" && reason !== "risk_vs_atr_high" && reason !== "stop_too_wide_pct" && reason !== "no_prior_thrust" && reason !== "flag_too_deep") {
    if (reason == null) {
      failed += 1
      console.error(`FAIL INO still on dock, want stop vs ATR / stop%`)
    }
  }
}

const packs = named.map(loadPack).filter((p): p is MarketPack => Boolean(p?.daily?.length))
if (packs.length) {
  const plans = packs.map(buildPlan)
  const dock = selectFinalists(plans)
  const hit = dock.finalists.map((p) => p.ticker)
  const banned = named.filter((t) => hit.includes(t) && t !== "CMPX")
  if (banned.length) {
    failed += 1
    console.error(`FAIL named names still on dock: ${banned.join(",")}`)
  }
  notes.push(`replay dock ${dock.finalists.length} / ${plans.length} named packs`)
}

for (const ticker of ["UMAC", "NEOG"] as const) {
  const pack = loadPack(ticker)
  if (!pack?.daily?.length) {
    notes.push(`${ticker}: cache missing, synthetic already ran`)
    continue
  }
  const plan = buildPlan(pack)
  const reason = rejectReason(plan)
  const line = `scan4 ${ticker} grade=${plan.grade} family=${plan.setupType} reject=${reason} stop=${plan.stopPrice}`
  notes.push(line)
  console.log(line)
  if (ticker === "UMAC" && plan.grade === "Candidate" && reason == null) {
    failed += 1
    console.error("FAIL UMAC still on dock")
  }
  if (ticker === "NEOG" && plan.grade === "Candidate" && reason == null) {
    failed += 1
    console.error("FAIL NEOG still on dock (coil should not Candidate)")
  }
}

if (fs.existsSync(scan4Path)) {
  try {
    const dockFile = JSON.parse(fs.readFileSync(scan4Path, "utf8")) as { finalists?: Array<{ ticker: string }> }
    const tickers = (dockFile.finalists ?? []).map((row) => row.ticker)
    const loaded = tickers.map(loadPack).filter((p): p is MarketPack => Boolean(p?.daily?.length))
    if (loaded.length) {
      const replay = selectFinalists(loaded.map(buildPlan))
      const hit = new Set(replay.finalists.map((p) => p.ticker))
      if (hit.has("UMAC") || hit.has("NEOG")) {
        failed += 1
        console.error(`FAIL scan-4 replay still docking ${[...hit].filter((t) => t === "UMAC" || t === "NEOG").join(",")}`)
      }
      notes.push(`scan-4 replay dock ${replay.finalists.length} / ${loaded.length} cached of ${tickers.length}`)
      console.log(`scan-4 replay dock ${replay.finalists.map((p) => `${p.ticker}:${p.setupType.split(" ")[0]}`).join(", ") || "(empty)"}`)
    } else {
      notes.push("scan-4 dock packs missing from cache")
    }
  } catch (err) {
    notes.push(`scan-4 json unreadable: ${err instanceof Error ? err.message : String(err)}`)
  }
}

if (failed) {
  console.error(`${failed} failed`)
  if (skipped.length) console.error("skipped", skipped.join(","))
  process.exit(1)
}
console.log(`ok analyze replay. skipped=${skipped.length ? skipped.join(",") : "none"}`)
