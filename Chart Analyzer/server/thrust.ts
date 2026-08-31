export interface PriorThrust {
  /** Close-to-close range over the window, in percent (25 = 25%). */
  rangePct: number
  lastInUpperHalf: boolean
  pass: boolean
}

/**
 * 60-session thrust. Close-to-close, no wicks.
 * Passes only when the range is >= floor and last close is in the upper half
 * of that range. A name that rallied and sat back on the lows of the box fails.
 * Fewer than 60 daily closes → null (caller must fail the gate, not invent a pass).
 */
export function priorThrust60d(closes: number[], floorPct = 20): PriorThrust | null {
  if (closes.length < 60) return null
  const window = closes.slice(-60)
  let minC = Infinity
  let maxC = -Infinity
  for (const close of window) {
    if (close < minC) minC = close
    if (close > maxC) maxC = close
  }
  if (!(minC > 0) || !(maxC >= minC)) return null
  const rangePct = ((maxC - minC) / minC) * 100
  const mid = (minC + maxC) / 2
  const lastClose = window[window.length - 1]
  const lastInUpperHalf = lastClose >= mid
  return {
    rangePct,
    lastInUpperHalf,
    pass: rangePct >= floorPct && lastInUpperHalf,
  }
}

export function closesFromBars(bars: Array<{ close: number }> | undefined): number[] {
  if (!bars?.length) return []
  return bars.map((bar) => bar.close)
}
