import type { DeskRegime, OhlcvBar } from "../src/types"
import { last, sma } from "./indicators"
import { weeklyStageFrom } from "./template"

const DIST_LOOKBACK = 25
const DIST_DOWN_PCT = 0.002
const DIST_MAX = 6

export function dropLiveSession(bars: OhlcvBar[], sessionDate: string | null) {
  if (!bars.length || !sessionDate) return bars
  const lastDate = bars[bars.length - 1].time.slice(0, 10)
  if (lastDate === sessionDate) return bars.slice(0, -1)
  return bars
}

/** IBD-style: down ≥ 0.2% on volume greater than the prior session. */
export function distributionDays(bars: OhlcvBar[], lookback = DIST_LOOKBACK) {
  if (bars.length < 2) return 0
  const end = bars.length - 1
  const start = Math.max(1, end - lookback + 1)
  let n = 0
  for (let i = start; i <= end; i++) {
    const prev = bars[i - 1]
    const bar = bars[i]
    if (!(prev.close > 0)) continue
    const down = (bar.close - prev.close) / prev.close <= -DIST_DOWN_PCT
    const heavy = bar.volume > prev.volume
    if (down && heavy) n += 1
  }
  return n
}

export function evaluateRegime(
  qqqDaily: OhlcvBar[],
  spyWeekly: OhlcvBar[],
  sessionDate?: string | null,
): DeskRegime {
  const empty = (reason: string, status: DeskRegime["status"] = "unknown"): DeskRegime => ({
    status,
    allowsNewHeat: false,
    qqqSma10: null,
    qqqSma20: null,
    spyWeekly: null,
    distributionDays: 0,
    reason,
  })

  const qqq = dropLiveSession(qqqDaily, sessionDate ?? null)
  if (qqq.length < 20) {
    return empty("Regime unknown. Could not read QQQ daily 10/20. No new heat.")
  }

  const closes = qqq.map((b) => b.close)
  const sma10 = last(sma(closes, 10))
  const sma20 = last(sma(closes, 20))
  const dist = distributionDays(qqq)
  const spyStage = spyWeekly.length >= 35 ? weeklyStageFrom(spyWeekly) : null

  if (sma10 == null || sma20 == null) {
    return empty("Regime unknown. QQQ 10/20 SMA is not ready. No new heat.")
  }

  const stacked = sma10 > sma20
  if (!stacked) {
    return {
      status: "closed",
      allowsNewHeat: false,
      qqqSma10: sma10,
      qqqSma20: sma20,
      spyWeekly: spyStage,
      distributionDays: dist,
      reason: "Regime closed. Index 10/20 is not stacked. No new heat.",
    }
  }

  if (dist >= DIST_MAX) {
    return {
      status: "pressure",
      allowsNewHeat: false,
      qqqSma10: sma10,
      qqqSma20: sma20,
      spyWeekly: spyStage,
      distributionDays: dist,
      reason: `Pressure. ${dist} distribution days in ${DIST_LOOKBACK} sessions on QQQ. No new heat.`,
    }
  }

  if (spyStage != null && spyStage !== "up") {
    return {
      status: "closed",
      allowsNewHeat: false,
      qqqSma10: sma10,
      qqqSma20: sma20,
      spyWeekly: spyStage,
      distributionDays: dist,
      reason: "Regime closed. SPY weekly is not above a rising 30-week SMA. No new heat.",
    }
  }

  return {
    status: "open",
    allowsNewHeat: true,
    qqqSma10: sma10,
    qqqSma20: sma20,
    spyWeekly: spyStage,
    distributionDays: dist,
    reason: spyStage === "up"
      ? "Tape is open. QQQ 10 above 20, SPY weekly confirm holds."
      : "Tape is open. QQQ 10 above 20.",
  }
}
