import type { OhlcvBar } from "../src/types"
import { last, sma } from "./indicators"

export interface TemplateResult {
  pass: boolean
  reasons: string[]
  sma50: number | null
  sma150: number | null
  sma200: number | null
}

/** Minervini 50/150/200 SMA stack + 52w location. All bits required. */
export function trendTemplate(
  closes: number[],
  lastClose: number,
  high52: number | null,
  low52: number | null,
): TemplateResult {
  const reasons: string[] = []
  const s50 = sma(closes, 50)
  const s150 = sma(closes, 150)
  const s200 = sma(closes, 200)
  const sma50 = last(s50)
  const sma150 = last(s150)
  const sma200 = last(s200)
  const sma200Ago = closes.length >= 221 ? s200[s200.length - 22] ?? null : null

  if (sma50 == null || sma150 == null || sma200 == null) {
    return { pass: false, reasons: ["Not enough daily history for the 50/150/200 SMA template."], sma50, sma150, sma200 }
  }
  if (!(lastClose > sma50 && lastClose > sma150 && lastClose > sma200)) {
    reasons.push("Price is not above the 50, 150, and 200 SMAs.")
  }
  if (!(sma50 > sma150 && sma150 > sma200)) {
    reasons.push("SMAs are not stacked 50 > 150 > 200.")
  }
  if (sma200Ago == null || !(sma200 > sma200Ago)) {
    reasons.push("200-SMA is not rising versus 21 sessions ago.")
  }
  if (high52 != null && high52 > 0 && lastClose < high52 * 0.75) {
    reasons.push("Price is more than 25% below the 52-week high.")
  }
  if (low52 != null && low52 > 0 && lastClose < low52 * 1.30) {
    reasons.push("Price is not at least 30% above the 52-week low.")
  }
  return { pass: reasons.length === 0, reasons, sma50, sma150, sma200 }
}

export type WeeklyStage = "up" | "down" | "sideways"

/** Weinstein-style weekly: close vs 30-week SMA slope (5 weeks). */
export function weeklyStageFrom(weekly: OhlcvBar[]): WeeklyStage {
  if (weekly.length < 35) return "sideways"
  const closes = weekly.map((b) => b.close)
  const s30 = sma(closes, 30)
  const lastClose = closes[closes.length - 1]
  const now = last(s30)
  const ago = s30[s30.length - 6] ?? null
  if (now == null || ago == null) return "sideways"
  const rising = now > ago
  const falling = now < ago
  if (lastClose > now && rising) return "up"
  if (lastClose < now && falling) return "down"
  return "sideways"
}
