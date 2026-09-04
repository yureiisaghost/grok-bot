import type { OhlcvBar, PlanOfAttack } from "../src/types"
import { pickForBook, roomToR1 } from "./picker"
import { distributionDays, evaluateRegime } from "./regime"
import { overlayPlanQuote, quotePriority } from "./liveOverlay"
import { rejectReason } from "./finalists"
import { sameCluster } from "./cluster"

/** Rising 60-day thrust (~39%) plus a wobble so last-20 returns are not clones. */
function thrustChart(kind: 0 | 1 | 2 | 3): OhlcvBar[] {
  return Array.from({ length: 60 }, (_, i) => {
    const trend = 18 + i * 0.12
    const wobble =
      kind === 1 ? (i % 2 === 0 ? 0.65 : -0.55)
      : kind === 2 ? Math.sin(i * 1.8) * 0.8
      : kind === 3 ? ((i * 5) % 7) * 0.2 - 0.55
      : 0
    const close = Math.max(5, trend + wobble)
    return {
      time: `2026-01-${String((i % 27) + 1).padStart(2, "0")}`,
      open: close,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 2_000_000,
    }
  })
}

function plan(over: Partial<PlanOfAttack> = {}): PlanOfAttack {
  return {
    ticker: "AAA",
    name: "Alpha",
    grade: "Candidate",
    score: 80,
    setupType: "Bull Flag / First Pullback after Impulse",
    lastPrice: 25,
    previousClose: 24.5,
    changePct: 2,
    weeklyTrend: "up",
    readiness: "near",
    oneShareRisk: 1,
    earnDays: 40,
    entryMethod: "Stop-Limit",
    entryTrigger: "x",
    invalidation: "x",
    stop: "x",
    thesis: "Tight flag into the 20.",
    plan: "x",
    earnings: "x",
    warnings: [],
    entryPrice: 25,
    stopPrice: 24,
    pivot: 26,
    r1: 26,
    r2: 27,
    r3: 28,
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
      avgVolume: 2_000_000,
      relativeVolume: 1,
    },
    sizing: { equity: null, shares: null, dollarRisk: 1, note: "1-share" },
    geometry: {
      box: null,
      markers: [],
      caption: "0.2 ATR under trigger",
      pctToLevel: 0.4,
      atrToLevel: 0.2,
      levelLabel: "trigger",
    },
    chart: Array.from({ length: 60 }, (_, i) => {
      const close = 18 + i * 0.12
      return { time: `2026-01-${String(i + 1).padStart(2, "0")}`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 2_000_000 }
    }),
    ema20Series: [],
    ema50Series: [],
    analyzedAt: "now",
    flagRetracePct: 30,
    qualityScore: 80,
    ...over,
  }
}

const book = {
  accountNumber: "x",
  equity: 5000,
  cash: 3500,
  buyingPower: 3500,
  positions: [
    { ticker: "HELD", quantity: 20, avgCost: 30, lastPrice: 32, marketValue: 640 },
    { ticker: "HELD2", quantity: 10, avgCost: 40, lastPrice: 41, marketValue: 410 },
  ],
}

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed += 1
    console.error(`FAIL  ${name} — ${detail}`)
  }
}

const empty = pickForBook([], { ...book, positions: [] })
check("empty list", empty.pick == null && Boolean(empty.nothingReason) && empty.nothingStep === 0, empty.nothingReason ?? "missing reason")

const jammed = plan({ ticker: "JAM", r1: 25.2, levels: { ...plan().levels, high52: 25.1 } })
check("room to 1R blocked", (roomToR1(jammed) ?? 99) < 0.7, `room=${roomToR1(jammed)}`)

const a = plan({ ticker: "BEST", qualityScore: 90, sector: "Software" })
const b = plan({ ticker: "OKAY", qualityScore: 70, chart: thrustChart(1), sector: "Energy" })
const watch = plan({ ticker: "WAIT", grade: "Developing", readiness: "forming", qualityScore: 88 })
const held = plan({ ticker: "HELD", qualityScore: 99, chart: thrustChart(2), sector: "Healthcare" })
const assumed = pickForBook([watch, b, a], book, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 })
check("open heat uses assumed 1R when no stop on file", assumed.book.openHeat === 100, `heat=${assumed.book.openHeat}`)

const brokerHeat = pickForBook([watch], {
  ...book,
  positions: [{ ticker: "HELD", quantity: 20, avgCost: 30, lastPrice: 32, marketValue: 640, stopPrice: 29 }],
}, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 })
check("broker stop sizes open heat", brokerHeat.book.openHeat === 60 && brokerHeat.positions[0]?.heatNote === "broker stop", `${brokerHeat.book.openHeat} ${brokerHeat.positions[0]?.heatNote}`)

const snapshot = pickForBook([held, watch, b, a], book, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 })

check("does not pick a name already held", snapshot.pick?.ticker !== "HELD", snapshot.pick?.ticker ?? "none")
check("picks the higher quality near name", snapshot.pick?.ticker === "BEST", snapshot.pick?.ticker ?? "none")
check("runner is the second fit", snapshot.runnerUp?.ticker === "OKAY", snapshot.runnerUp?.ticker ?? "none")
check("watch is next-up not a pick", snapshot.nextUp.some((item) => item.ticker === "WAIT") && snapshot.pick?.ticker !== "WAIT", JSON.stringify(snapshot.nextUp))
check("sizes to leftover 1R", (snapshot.pick?.shares ?? 0) >= 1 && (snapshot.pick?.dollarRisk ?? 0) <= 50.01, `shares=${snapshot.pick?.shares} risk=${snapshot.pick?.dollarRisk}`)

const full = pickForBook([a], {
  ...book,
  positions: Array.from({ length: 6 }, (_, i) => ({
    ticker: `P${i}`,
    quantity: 1,
    avgCost: 10,
    lastPrice: 10,
    marketValue: 10,
  })),
})
check("heat full still shows the pick card", full.pick != null, full.pick?.ticker ?? "none")
check("heat full pick stays actionable", full.pick?.actionable !== false, String(full.pick?.actionable))

const closed = pickForBook([a], book, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 }, {
  regime: {
    status: "closed",
    allowsNewHeat: false,
    qqqSma10: 480,
    qqqSma20: 490,
    spyWeekly: "down",
    distributionDays: 2,
    reason: "Regime closed. Index 10/20 is not stacked. No new heat.",
  },
})
check("regime closed still shows the pick card", closed.pick != null, closed.pick?.ticker ?? "none")
check("regime closed pick stays actionable", closed.pick?.actionable !== false, String(closed.pick?.actionable))
check("regime closed does not empty the book", closed.nothingReason == null, closed.nothingReason ?? "none")
check("regime closed still shows the book", closed.book.equity === 5000, `equity=${closed.book.equity}`)

const pressure = pickForBook([a], { ...book, positions: [] }, undefined, {
  regime: {
    status: "pressure",
    allowsNewHeat: false,
    qqqSma10: 500,
    qqqSma20: 490,
    spyWeekly: "up",
    distributionDays: 7,
    reason: "Pressure. 7 distribution days in 25 sessions on QQQ. No new heat.",
  },
})
check("pressure still shows the pick card", pressure.pick != null, pressure.pick?.ticker ?? "none")
check("pressure pick stays actionable", pressure.pick?.actionable !== false, String(pressure.pick?.actionable))
check("pressure does not empty the book", pressure.nothingReason == null, pressure.nothingReason ?? "none")

const blackout = pickForBook([a], { ...book, positions: [] }, undefined, {
  regime: {
    status: "blackout",
    allowsNewHeat: false,
    qqqSma10: 500,
    qqqSma20: 490,
    spyWeekly: "up",
    distributionDays: 1,
    reason: "Macro blackout. FOMC 2026-09-16. No new names.",
  },
})
check("blackout still shows the pick card", blackout.pick != null, blackout.pick?.ticker ?? "none")
check("blackout pick stays actionable", blackout.pick?.actionable !== false, String(blackout.pick?.actionable))
check("blackout does not empty the book", blackout.nothingReason == null, blackout.nothingReason ?? "none")
check("blackout still shows the book", blackout.book.equity === 5000, `equity=${blackout.book.equity}`)

check("ticket is stop-limit", (snapshot.pick?.entryMethod ?? "") === "Buy stop-limit" && (snapshot.pick?.stopKind ?? "") === "Stop-market", JSON.stringify({ m: snapshot.pick?.entryMethod, s: snapshot.pick?.stopKind }))
check("limit ceiling above trigger", (snapshot.pick?.limitCeiling ?? 0) > (snapshot.pick?.entryPrice ?? 0), `ceil=${snapshot.pick?.limitCeiling} trig=${snapshot.pick?.entryPrice}`)
check("notional at or under 20% equity", (snapshot.pick?.notional ?? 99_999) <= book.equity * 0.20 + 0.01, `notion=${snapshot.pick?.notional}`)

function qBar(i: number, close: number, volume = 10_000_000): OhlcvBar {
  return {
    time: `2026-03-${String((i % 28) + 1).padStart(2, "0")}`,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume,
  }
}
const risingQqq = Array.from({ length: 40 }, (_, i) => qBar(i, 400 + i * 1.5, 8_000_000))
const fallingQqq = Array.from({ length: 40 }, (_, i) => qBar(i, 500 - i * 1.5, 8_000_000))
const openTape = evaluateRegime(risingQqq, [])
check("rising QQQ opens the tape", openTape.status === "open" && openTape.allowsNewHeat, openTape.reason)
const shutTape = evaluateRegime(fallingQqq, [])
check("falling QQQ closes the tape", shutTape.status === "closed" && !shutTape.allowsNewHeat, shutTape.reason)
const missingTape = evaluateRegime([], [])
check("missing QQQ is unknown", missingTape.status === "unknown" && !missingTape.allowsNewHeat, missingTape.reason)

const distBars: OhlcvBar[] = []
let px = 100
for (let i = 0; i < 8; i++) {
  distBars.push(qBar(i, px, 1_000_000 + i))
  px -= 0.4
}
check("distribution days count down-volume", distributionDays(distBars) >= 6, `n=${distributionDays(distBars)}`)

const liveChase = overlayPlanQuote(plan({
  lastPrice: 25,
  entryPrice: 25.2,
  geometry: { ...plan().geometry, atrToLevel: 0.25, pctToLevel: 0.8 },
}), { last: 25.7, previousClose: 25 })
check("live last through trigger is chase", rejectReason(liveChase) === "chase_through", rejectReason(liveChase) ?? "null")
const liveNear = overlayPlanQuote(plan({
  lastPrice: 25,
  entryPrice: 25.2,
  geometry: { ...plan().geometry, atrToLevel: 0.25, pctToLevel: 0.8 },
}), { last: 25.15, previousClose: 25 })
check("live last still near is not chase", rejectReason(liveNear) == null, rejectReason(liveNear) ?? "null")

const biox = plan({
  ticker: "BIOX",
  sector: "Biotechnology",
  lastPrice: 32,
  entryPrice: 32.2,
  stopPrice: 31,
  oneShareRisk: 1,
  chart: thrustChart(2),
})
const newb = plan({
  ticker: "NEWB",
  sector: "Biotechnology",
  qualityScore: 91,
})
const clusterBook = {
  ...book,
  cash: 4000,
  positions: [{ ticker: "BIOX", quantity: 100, avgCost: 30, lastPrice: 32, marketValue: 3200 }],
}
const clustered = pickForBook([biox, newb], clusterBook, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 })
check(
  "same sector fills 2% cluster",
  clustered.pick == null && clustered.skipped.some((row) => /cluster/i.test(row.reason)),
  `pick=${clustered.pick?.ticker} skip=${clustered.skipped.map((row) => row.reason).join(";")}`,
)
const shop = plan({ ticker: "SHOPX", sector: "Consumer Cyclical", qualityScore: 88, chart: thrustChart(3) })
const uncorr = pickForBook([biox, shop], clusterBook, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 })
check("uncorrelated other sector can still pick", uncorr.pick?.ticker === "SHOPX", uncorr.pick?.ticker ?? uncorr.nothingReason ?? "none")
check(
  "BEST and OKAY are not a correlation cluster",
  !sameCluster(a, b, a.chart.map((bar) => bar.close), b.chart.map((bar) => bar.close)),
  "corr",
)
check("identical ramps cluster without a tag", sameCluster(plan({ ticker: "A1" }), plan({ ticker: "A2" }), plan().chart.map((bar) => bar.close), plan().chart.map((bar) => bar.close)), "corr")
check(
  "empty sector does not cluster without returns",
  !sameCluster(plan({ ticker: "A1" }), { ticker: "A2", sector: null }, null, null),
  "tagged empty",
)
check(
  "same sector clusters without bars",
  sameCluster(plan({ ticker: "A1", sector: "Biotechnology" }), { ticker: "A2", sector: "Biotechnology" }, null, null),
  "tag",
)
check(
  "quote order is held then Candidates",
  quotePriority(
    [{ ticker: "WAIT", grade: "Developing" }, { ticker: "BEST", grade: "Candidate" }],
    [{ ticker: "HELD" }],
  ).join(",") === "HELD,BEST,WAIT",
  quotePriority(
    [{ ticker: "WAIT", grade: "Developing" }, { ticker: "BEST", grade: "Candidate" }],
    [{ ticker: "HELD" }],
  ).join(","),
)
check("overlay keeps the saved setup", liveChase.setupType === plan().setupType && liveChase.grade === "Candidate", liveChase.setupType)

const workingPick = {
  ticker: "BEST",
  name: "Alpha",
  setupType: "Bull Flag / First Pullback after Impulse",
  grade: "Candidate" as const,
  shares: 1,
  dollarRisk: 50,
  notional: 25,
  notionalPct: 0.5,
  entryPrice: 25,
  stopPrice: 24,
  r1: 26,
  lastPrice: 25,
  qualityScore: 90,
  roomToR1: 1,
  why: "working",
  thesis: "x",
  entryMethod: "Buy stop-limit",
  limitCeiling: 25.5,
  stopKind: "Stop-market",
  orderStatus: "pending" as const,
}
const workingSnap = pickForBook([a, b], { ...book, positions: [] }, { riskPct: 1, maxHeatPct: 6, maxNewNames: 2 }, {
  working: [workingPick],
})
check("skips a name with a working buy", workingSnap.pick?.ticker === "OKAY", workingSnap.pick?.ticker ?? "none")
check("pending heat is reserved", workingSnap.book.pendingHeat === 50 && workingSnap.book.remainingHeat === 250, `pending=${workingSnap.book.pendingHeat} left=${workingSnap.book.remainingHeat}`)

if (failed) {
  console.error(`\n${failed} picker checks failed`)
  process.exit(1)
}
console.log("\nall picker checks passed")
