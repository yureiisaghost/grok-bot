import type { DeskPosition, DeskRegime, OhlcvBar, PlanOfAttack } from "../src/types"
import { clusterTag } from "./cluster"
import { ema, last, sma } from "./indicators"
import { dropLiveSession } from "./regime"

const EARN_WINDOW = 5
const TIME_SESSIONS = 8
const FAIL_SESSIONS = 5
const VOL_SMA = 50

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

export function isoDaysUntil(target: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${target}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN
  return Math.round((b - a) / 86_400_000)
}

export function barDate(time: string) {
  return time.slice(0, 10)
}

export function sessionsAfterFill(bars: OhlcvBar[], fillDate: string, sessionDate: string): OhlcvBar[] {
  const completed = dropLiveSession(bars, sessionDate)
  return completed.filter((bar) => barDate(bar.time) > fillDate)
}

export function trailHint(bars: OhlcvBar[], regimeClosed: boolean, sessionDate: string) {
  const completed = dropLiveSession(bars, sessionDate)
  const closes = completed.map((bar) => bar.close)
  const ema20 = last(ema(closes, 20))
  const sma10 = last(sma(closes, 10))
  const lastClose = closes.length ? closes[closes.length - 1] : null
  if (regimeClosed && sma10 != null) {
    return {
      kind: "sma10" as const,
      px: sma10,
      lastClose,
      below: lastClose != null && lastClose < sma10,
    }
  }
  if (ema20 != null) {
    return {
      kind: "ema20" as const,
      px: ema20,
      lastClose,
      below: lastClose != null && lastClose < ema20,
    }
  }
  return { kind: null, px: null, lastClose, below: false }
}

export function reached1R(
  lastPx: number | null,
  basis: number | null,
  shareRisk: number | null,
): boolean {
  return finite(lastPx) && finite(basis) && finite(shareRisk) && shareRisk > 0 && lastPx >= basis + shareRisk
}

export function nextRLevel(
  lastPx: number | null,
  basis: number | null,
  shareRisk: number | null,
  plan?: Pick<PlanOfAttack, "r1" | "r2" | "r3"> | null,
): number | null {
  const levels = [plan?.r1, plan?.r2, plan?.r3].filter((n): n is number => finite(n)).sort((a, b) => a - b)
  if (finite(lastPx)) {
    const nextWritten = levels.find((level) => level > lastPx)
    if (nextWritten != null) return nextWritten
  }
  if (finite(basis) && finite(shareRisk) && shareRisk > 0) {
    const r = finite(lastPx) ? (lastPx - basis) / shareRisk : 0
    return basis + (Math.floor(Math.max(0, r)) + 1) * shareRisk
  }
  return plan?.r1 ?? null
}

export function failedBreak(
  bars: OhlcvBar[],
  fillDate: string,
  pivot: number | null,
  sessionDate: string,
): boolean {
  if (!finite(pivot)) return false
  const completed = dropLiveSession(bars, sessionDate)
  const vols = completed.map((bar) => bar.volume)
  const volSma = sma(vols, VOL_SMA)
  const post = completed.filter((bar) => barDate(bar.time) > fillDate).slice(0, FAIL_SESSIONS)
  for (const bar of post) {
    const idx = completed.findIndex((row) => row.time === bar.time)
    const avg = idx >= 0 ? volSma[idx] : null
    if (avg == null || !(avg > 0)) continue
    if (bar.close < pivot && bar.volume >= avg) return true
  }
  return false
}

function shareRiskOf(plan: PlanOfAttack | undefined, pos: DeskPosition): number | null {
  const risk = plan?.oneShareRisk ?? plan?.sizing?.dollarRisk
  if (finite(risk) && risk > 0) return risk
  const stop = pos.stopPrice ?? plan?.stopPrice
  if (finite(pos.avgCost) && finite(stop) && pos.avgCost > stop) {
    return pos.avgCost - stop
  }
  return null
}

export function nextHeldRule(input: {
  throughStop: boolean
  earnDays: number | null
  failedBreak: boolean
  sessionsHeld: number | null
  hasFill: boolean
  hit1R: boolean
  rMultiple: number | null
  trailBelow: boolean
  trailKind: "ema20" | "sma10" | null
}): string {
  if (input.throughStop) return "E1/E3 — last through the scan stop"
  if (input.earnDays != null && input.earnDays >= 0 && input.earnDays <= EARN_WINDOW) {
    return input.earnDays === 0
      ? "E8 flatten — earnings today"
      : `E8 flatten — earnings in ${input.earnDays}d`
  }
  if (input.hasFill && input.failedBreak) return "E10 failed break — close back under pivot on heavy volume"
  if (input.hasFill && (input.sessionsHeld ?? 0) >= TIME_SESSIONS && !input.hit1R) {
    return `E7 time — ${input.sessionsHeld} sessions without +1R`
  }
  if (input.rMultiple != null && input.rMultiple >= 2) return "E4/E5 — +2R, stop to breakeven and scale"
  if (input.trailBelow) {
    return input.trailKind === "sma10"
      ? "E6 trail — close below 10 SMA (regime closed)"
      : "E6 trail — close below 20 EMA"
  }
  return input.trailKind === "sma10"
    ? "Hold. Trail 10 SMA (regime closed)."
    : "Hold. Trail 20 EMA."
}

export function annotateHeldPositions(
  positions: DeskPosition[],
  opts: {
    plans: PlanOfAttack[]
    extraBars?: Record<string, OhlcvBar[]>
    extraEarn?: Record<string, string>
    regime: DeskRegime | null
    today: string
  },
): DeskPosition[] {
  const byTicker = new Map(opts.plans.map((plan) => [plan.ticker.toUpperCase(), plan]))
  const regimeClosed = opts.regime?.status === "closed"
  return positions.map((pos) => {
    const ticker = pos.ticker.toUpperCase()
    const plan = byTicker.get(ticker)
    const bars = (opts.extraBars?.[ticker]?.length ? opts.extraBars[ticker] : null)
      ?? plan?.chart
      ?? []
    const earnDate = opts.extraEarn?.[ticker]
      ?? (typeof plan?.earnings === "string" && /\d{4}-\d{2}-\d{2}/.test(plan.earnings)
        ? plan.earnings.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null
        : null)
    const earnDays = earnDate
      ? isoDaysUntil(earnDate, opts.today)
      : (plan?.earnDays ?? null)
    const risk = shareRiskOf(plan, pos)
    const trail = trailHint(bars, regimeClosed, opts.today)
    const lastPx = pos.lastPrice ?? plan?.lastPrice ?? trail.lastClose ?? null
    const basis = pos.avgCost ?? plan?.entryPrice ?? null
    const rMultiple = finite(lastPx) && finite(pos.avgCost) && finite(risk) && risk > 0
      ? (lastPx - pos.avgCost) / risk
      : null
    const hit1R = reached1R(lastPx, basis, risk)
    const stop = pos.stopPrice ?? plan?.stopPrice ?? null
    const throughStop = finite(stop) && finite(lastPx) && lastPx <= stop
    const openPnl = finite(lastPx) && finite(pos.avgCost)
      ? Math.round((lastPx - pos.avgCost) * pos.quantity * 100) / 100
      : null
    const nextR = nextRLevel(lastPx, basis, risk, plan)
    const nextRule = nextHeldRule({
      throughStop,
      earnDays: earnDays != null && Number.isFinite(earnDays) ? earnDays : null,
      failedBreak: false,
      sessionsHeld: null,
      hasFill: false,
      hit1R,
      rMultiple,
      trailBelow: trail.below,
      trailKind: trail.kind,
    })
    return {
      ...pos,
      clusterTag: pos.clusterTag ?? clusterTag(plan),
      earnDays: earnDays != null && Number.isFinite(earnDays) ? earnDays : null,
      earnDate,
      trailKind: trail.kind,
      trailPx: trail.px,
      rMultiple,
      fillDate: null,
      sessionsHeld: null,
      nextRule,
      stopPrice: stop,
      nextRPrice: nextR,
      openPnl,
    }
  })
}
