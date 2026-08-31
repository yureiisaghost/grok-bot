import type { PlanOfAttack } from "../src/types"
import { pct } from "./indicators"

export interface LiveQuote {
  last: number
  previousClose: number | null
}

/** Live RTH last for distance / rejectReason / roomToR1. Does not re-run detectors. */
export function overlayPlanQuote(plan: PlanOfAttack, quote: LiveQuote): PlanOfAttack {
  if (!(quote.last > 0)) return plan
  const last = quote.last
  const previousClose = quote.previousClose != null && quote.previousClose > 0
    ? quote.previousClose
    : plan.previousClose
  const trigger = plan.entryPrice
  const atr = plan.levels?.atr14
  let atrToLevel = plan.geometry?.atrToLevel ?? null
  let pctToLevel = plan.geometry?.pctToLevel ?? null
  if (trigger != null && trigger > 0) {
    pctToLevel = ((trigger - last) / last) * 100
    atrToLevel = atr != null && atr > 0 ? (trigger - last) / atr : null
  }
  const risk = plan.oneShareRisk
  return {
    ...plan,
    lastPrice: last,
    previousClose,
    changePct: previousClose > 0 ? pct(previousClose, last) : plan.changePct,
    stopPct: risk != null && last > 0 ? (risk / last) * 100 : plan.stopPct,
    geometry: {
      ...plan.geometry,
      atrToLevel,
      pctToLevel,
    },
  }
}

export function quotePriority(
  plans: Array<{ ticker: string; grade?: string }>,
  positions: Array<{ ticker: string }>,
  cap = 20,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (raw: string) => {
    const ticker = raw.trim().toUpperCase()
    if (!ticker || seen.has(ticker) || out.length >= cap) return
    seen.add(ticker)
    out.push(ticker)
  }
  for (const pos of positions) push(pos.ticker)
  for (const plan of plans) {
    if (plan.grade === "Candidate") push(plan.ticker)
  }
  for (const plan of plans) push(plan.ticker)
  return out
}

export function applyQuotesToPositions<T extends { ticker: string; lastPrice: number | null; marketValue: number | null; quantity: number }>(
  positions: T[],
  quotes: Map<string, LiveQuote>,
): T[] {
  return positions.map((pos) => {
    const quote = quotes.get(pos.ticker.toUpperCase())
    if (!quote || !(quote.last > 0)) return pos
    return {
      ...pos,
      lastPrice: quote.last,
      marketValue: quote.last * pos.quantity,
    }
  })
}
