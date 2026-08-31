import type { DeskPosition, DeskRegime, OhlcvBar, PlanOfAttack } from "../src/types"
import { applyMacroBlackout, macroHit, nextMacro, prevWeekday } from "./macro"
import { annotateHeldPositions, failedBreak, isoDaysUntil, nextHeldRule, nextRLevel, reached1R, sessionsAfterFill, trailHint } from "./heldState"

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed += 1
    console.error(`FAIL  ${name} — ${detail}`)
  }
}

const events = [
  { date: "2026-09-04", kind: "NFP" as const, name: "Employment Situation" },
  { date: "2026-09-11", kind: "CPI" as const, name: "Consumer Price Index" },
  { date: "2026-09-16", kind: "FOMC" as const, name: "FOMC decision" },
]

check("weekday before Wednesday is Tuesday", prevWeekday("2026-09-16") === "2026-09-15", prevWeekday("2026-09-16"))
check("weekday before Monday is Friday", prevWeekday("2026-09-14") === "2026-09-11", prevWeekday("2026-09-14"))
check("FOMC day is a blackout", macroHit("2026-09-16", events)?.session === "event", JSON.stringify(macroHit("2026-09-16", events)))
check("session before FOMC is a blackout", macroHit("2026-09-15", events)?.kind === "FOMC" && macroHit("2026-09-15", events)?.session === "prior", JSON.stringify(macroHit("2026-09-15", events)))
check("two sessions before FOMC is open", macroHit("2026-09-14", events) == null, JSON.stringify(macroHit("2026-09-14", events)))
check("next macro on a quiet day", nextMacro("2026-08-28", events)?.date === "2026-09-04", nextMacro("2026-08-28", events)?.date ?? "none")

const openTape: DeskRegime = {
  status: "open",
  allowsNewHeat: true,
  qqqSma10: 500,
  qqqSma20: 490,
  spyWeekly: "up",
  distributionDays: 1,
  reason: "Tape is open.",
}
const shut = applyMacroBlackout(openTape, "2026-09-16", events)
check("open tape blackouts on FOMC", shut.status === "blackout" && !shut.allowsNewHeat, shut.reason)
check("blackout copy names the event", /FOMC 2026-09-16/.test(shut.reason), shut.reason)

const closedTape: DeskRegime = { ...openTape, status: "closed", allowsNewHeat: false, reason: "Regime closed." }
const stillClosed = applyMacroBlackout(closedTape, "2026-09-16", events)
check("closed tape stays closed on FOMC", stillClosed.status === "closed" && stillClosed.nextMacro?.kind === "FOMC", stillClosed.status)

const quiet = applyMacroBlackout(openTape, "2026-08-28", events)
check("quiet day stays open", quiet.status === "open" && quiet.allowsNewHeat && quiet.nextMacro?.date === "2026-09-04", quiet.status)

check("calendar days to earnings", isoDaysUntil("2026-09-02", "2026-08-28") === 5, String(isoDaysUntil("2026-09-02", "2026-08-28")))

function bar(i: number, close: number, volume = 1_000_000): OhlcvBar {
  const day = 10 + (i % 18)
  return {
    time: `2026-01-${String(day).padStart(2, "0")}`,
    open: close,
    high: close + 0.2,
    low: close - 0.2,
    close,
    volume,
  }
}

const rising = Array.from({ length: 60 }, (_, i) => bar(i, 20 + i * 0.1, 1_000_000))
const trail20 = trailHint(rising, false, "2026-08-28")
check("open regime trails the 20 EMA", trail20.kind === "ema20" && trail20.px != null, String(trail20.kind))
const trail10 = trailHint(rising, true, "2026-08-28")
check("closed regime accelerates to 10 SMA", trail10.kind === "sma10" && trail10.px != null, String(trail10.kind))

const postFill = [
  ...Array.from({ length: 50 }, (_, i) => ({ ...bar(i, 20 + i * 0.05, 800_000), time: `2026-06-${String((i % 27) + 1).padStart(2, "0")}` })),
  { time: "2026-08-20", open: 25, high: 25.4, low: 24.8, close: 25.2, volume: 900_000 },
  { time: "2026-08-21", open: 25.1, high: 25.3, low: 24.2, close: 24.4, volume: 2_000_000 },
  { time: "2026-08-22", open: 24.5, high: 24.8, low: 24.1, close: 24.3, volume: 700_000 },
]
const light = postFill.map((row, i) => i === postFill.length - 2 ? { ...row, volume: 100_000 } : row)
check("failed break needs close under pivot on heavy vol", failedBreak(postFill, "2026-08-20", 25, "2026-08-28") === true, "expected E10")
check("light volume under pivot is not E10", failedBreak(light, "2026-08-20", 25, "2026-08-28") === false, "vol")

const eight = Array.from({ length: 8 }, (_, i) => ({
  time: `2026-08-${String(21 + i).padStart(2, "0")}`,
  open: 25,
  high: 25.2,
  low: 24.8,
  close: 25.1,
  volume: 1_000_000,
}))
check("eight sessions after fill", sessionsAfterFill(eight, "2026-08-20", "2026-09-01").length === 8, String(sessionsAfterFill(eight, "2026-08-20", "2026-09-01").length))
check("+1R from fill", reached1R(27, 25, 1) === true, "1R")
check("no 1R yet", reached1R(25.4, 25, 1) === false, "0.4R")

check("no fill skips E7/E10", nextHeldRule({
  throughStop: false, earnDays: 40, failedBreak: false, sessionsHeld: null, hasFill: false, hit1R: false, rMultiple: 0.2, trailBelow: false, trailKind: "ema20",
}) === "Hold. Trail 20 EMA.", "copy")
check("E8 beats the rest", /E8/.test(nextHeldRule({
  throughStop: false, earnDays: 3, failedBreak: true, sessionsHeld: 9, hasFill: true, hit1R: false, rMultiple: 2.1, trailBelow: true, trailKind: "ema20",
})), "priority")
check("E7 after 8 dead sessions", /E7/.test(nextHeldRule({
  throughStop: false, earnDays: 40, failedBreak: false, sessionsHeld: 8, hasFill: true, hit1R: false, rMultiple: 0.2, trailBelow: false, trailKind: "ema20",
})), "time")

const pos: DeskPosition = {
  ticker: "HELD",
  quantity: 10,
  avgCost: 25,
  lastPrice: 25.4,
  marketValue: 254,
  dollarHeat: 14,
  heatNote: "scan stop",
}
const plan = {
  ticker: "HELD",
  oneShareRisk: 1,
  earnDays: 40,
  earnings: "Next report 2026-09-02 (5d).",
  pivot: 26,
  entryPrice: 25.2,
  stopPrice: 24,
  lastPrice: 25.4,
  chart: rising,
} as PlanOfAttack
const stamped = annotateHeldPositions([pos], {
  plans: [plan],
  regime: openTape,
  today: "2026-08-28",
})
check("E8 warns inside 5 days without flattening", /E8/.test(stamped[0].nextRule ?? "") && stamped[0].earnDays === 5, stamped[0].nextRule ?? "none")
check("no fill date leaves E7 off", stamped[0].fillDate == null && (stamped[0].sessionsHeld == null), String(stamped[0].fillDate))
check("open P/L is last minus entry times qty", stamped[0].openPnl === 4, String(stamped[0].openPnl))
check("next R is the next written level above last", stamped[0].nextRPrice === 26 && stamped[0].stopPrice === 24, `r=${stamped[0].nextRPrice} stop=${stamped[0].stopPrice}`)
check("next R after r1 uses r2", nextRLevel(26.1, 25, 1, { r1: 26, r2: 27, r3: 28 }) === 27, String(nextRLevel(26.1, 25, 1, { r1: 26, r2: 27, r3: 28 })))
check("next R past written levels is the next multiple", nextRLevel(29, 25, 1, { r1: 26, r2: 27, r3: 28 }) === 30, String(nextRLevel(29, 25, 1, { r1: 26, r2: 27, r3: 28 })))

const brokerOnly = annotateHeldPositions([{
  ticker: "LIVE",
  quantity: 1,
  avgCost: 42.64,
  lastPrice: 42.9,
  marketValue: 42.9,
  dollarHeat: 1.22,
  heatNote: "broker stop",
  stopPrice: 41.42,
}], {
  plans: [],
  regime: openTape,
  today: "2026-08-28",
})
check("broker stop fills the card when no scan plan", brokerOnly[0].stopPrice === 41.42, String(brokerOnly[0].stopPrice))
check("broker stop sizes 1R from cost", brokerOnly[0].nextRPrice === 43.86, String(brokerOnly[0].nextRPrice))

if (failed) {
  console.error(`\n${failed} held-state checks failed`)
  process.exit(1)
}
console.log("\nall held-state checks passed")
