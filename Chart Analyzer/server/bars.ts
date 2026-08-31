import type { OhlcvBar } from "../src/types"
import type { MarketPack } from "./market"

export function barDate(bar: OhlcvBar) {
  return bar.time.slice(0, 10)
}

/**
 * Detector series: last completed RTH session only.
 * If the last bar is today's session and the official close is still a prior date,
 * the last bar is a live overlay — drop it.
 * If the official close matches the last bar date, pin close to that print (not AH).
 */
export function completedDailyBars(pack: MarketPack): OhlcvBar[] {
  const bars = pack.daily
  if (!bars.length) return bars
  const lastDate = barDate(bars[bars.length - 1])
  const session = pack.quote.sessionDate ?? null
  const officialDate = pack.quote.officialCloseDate ?? null
  const officialClose = pack.quote.officialClose

  if (session && lastDate === session && officialDate && officialDate < session) {
    return bars.slice(0, -1)
  }

  if (officialDate && lastDate === officialDate && officialClose != null && officialClose > 0) {
    const next = bars.slice()
    const last = next[next.length - 1]
    next[next.length - 1] = {
      ...last,
      close: officialClose,
      high: Math.max(last.high, officialClose),
      low: Math.min(last.low, officialClose),
    }
    return next
  }

  return bars
}

/** Qullamaggie ADR%: 100 * (mean(H/L over 20) - 1). */
export function adrPct(bars: OhlcvBar[], period = 20): number | null {
  if (bars.length < period) return null
  const slice = bars.slice(-period)
  let sum = 0
  for (const bar of slice) {
    if (!(bar.low > 0) || !(bar.high > 0)) return null
    sum += bar.high / bar.low
  }
  return 100 * (sum / slice.length - 1)
}

export function dollarAdv(bars: OhlcvBar[], period = 50): number | null {
  if (bars.length < 5) return null
  const slice = bars.slice(-Math.min(period, bars.length))
  let sum = 0
  let n = 0
  for (const bar of slice) {
    if (bar.close > 0 && bar.volume >= 0) {
      sum += bar.close * bar.volume
      n += 1
    }
  }
  if (!n) return null
  return sum / n
}

export function range52(bars: OhlcvBar[]): { high: number; low: number } | null {
  const slice = bars.slice(-252)
  if (slice.length < 20) return null
  let high = -Infinity
  let low = Infinity
  for (const bar of slice) {
    if (bar.high > high) high = bar.high
    if (bar.low < low) low = bar.low
  }
  if (!(high >= low) || !(low > 0)) return null
  return { high, low }
}

/** Through-trigger if distance ≥ min(0.5 ATR, 2% of price). */
export function chasedThrough(close: number, trigger: number, atr: number | null, last: number) {
  const dist = close - trigger
  if (!(dist > 0) || !(trigger > 0)) return false
  const capAtr = atr != null && atr > 0 ? 0.5 * atr : Number.POSITIVE_INFINITY
  const capPct = last > 0 ? 0.02 * last : Number.POSITIVE_INFINITY
  const cap = Math.min(capAtr, capPct)
  return Number.isFinite(cap) && dist >= cap
}

/** ≥3 separate 20% close-to-close legs in the last 12 months → late-stage haircut. */
export function thrustLegCount(closes: number[], lookback = 252, minPct = 0.20) {
  if (closes.length < 40) return 0
  const start = Math.max(0, closes.length - lookback)
  let trough = closes[start]
  let legs = 0
  for (let i = start + 1; i < closes.length; i++) {
    const px = closes[i]
    if (px < trough) trough = px
    if (trough > 0 && (px - trough) / trough >= minPct) {
      legs += 1
      trough = px
    }
  }
  return legs
}

export function bannedInstrument(type: string | null | undefined, name: string | null | undefined, symbol: string) {
  const t = (type ?? "").toLowerCase().trim()
  if (!t) return false
  if (/warrant|unit|right|preferred|pfd|\blp\b|etn/.test(t)) return true
  if (t === "etp" || t === "etf" || t.includes("etp") || t.includes("etf")) return true
  const blob = `${name ?? ""} ${symbol}`.toLowerCase()
  if (/\b(2x|3x|ultra|inverse)\b/.test(blob)) return true
  return false
}
