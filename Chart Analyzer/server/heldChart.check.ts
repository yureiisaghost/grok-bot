import type { DeskPosition, OhlcvBar } from "../src/types"
import { buildHeldChartPlan } from "./heldChart"

let failed = 0
function check(name: string, ok: boolean, detail: string) {
  if (ok) console.log(`ok  ${name}`)
  else {
    failed += 1
    console.error(`FAIL  ${name} — ${detail}`)
  }
}

const bars: OhlcvBar[] = Array.from({ length: 80 }, (_, i) => ({
  time: `2026-01-${String((i % 27) + 1).padStart(2, "0")}`,
  open: 40 + i * 0.05,
  high: 40.2 + i * 0.05,
  low: 39.8 + i * 0.05,
  close: 40.1 + i * 0.05,
  volume: 1_000_000,
}))

const pos: DeskPosition = {
  ticker: "QGEN",
  quantity: 1,
  avgCost: 42.64,
  lastPrice: 43.7,
  marketValue: 43.7,
  dollarHeat: 1.22,
  heatNote: "broker stop",
  stopPrice: 41.42,
  nextRPrice: 43.86,
  nextRule: "Hold. Trail 20 EMA.",
}

const plan = buildHeldChartPlan(pos, bars)
check("held chart is marked chart-only", plan.heldChart === true && plan.setupType === "Open position", plan.setupType)
check("does not invent a Candidate grade for the card", plan.grade !== "Candidate", plan.grade)
check("keeps daily bars", plan.chart.length === 80, String(plan.chart.length))
check("draws 20/50 EMAs", plan.ema20Series.some((n) => n != null) && plan.ema50Series.some((n) => n != null), "ema")
check("overlays book entry and stop", plan.entryPrice === 42.64 && plan.stopPrice === 41.42, `${plan.entryPrice}/${plan.stopPrice}`)
check("R1 is entry plus 1R", plan.r1 === 43.86, String(plan.r1))
check("uses the live last", plan.lastPrice === 43.7, String(plan.lastPrice))

const empty = buildHeldChartPlan(pos, [])
check("empty bars still return a plan", empty.heldChart === true && empty.chart.length === 0, String(empty.chart.length))

if (failed) {
  console.error(`\n${failed} held-chart checks failed`)
  process.exit(1)
}
console.log("\nall held-chart checks passed")
