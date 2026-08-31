import type { OhlcvBar } from "../src/types"

export interface Coil {
  highIdx: number
  lowIdx: number
  high: number
  low: number
  depth: number
  span: number
}

function isLocalHigh(bars: OhlcvBar[], i: number, wing: number, lastIdx: number) {
  if (i < wing || i > lastIdx) return false
  const h = bars[i].high
  const from = i - wing
  const to = Math.min(lastIdx, i + wing)
  for (let j = from; j <= to; j++) {
    if (j === i) continue
    if (bars[j].high > h) return false
  }
  return true
}

function isLocalLow(bars: OhlcvBar[], i: number, wing: number, lastIdx: number) {
  if (i < wing || i > lastIdx) return false
  const l = bars[i].low
  const from = i - wing
  const to = Math.min(lastIdx, i + wing)
  for (let j = from; j <= to; j++) {
    if (j === i) continue
    if (bars[j].low < l) return false
  }
  return true
}

function minLow(bars: OhlcvBar[], from: number, to: number) {
  let idx = from
  let low = bars[from].low
  for (let i = from + 1; i <= to; i++) {
    if (bars[i].low < low) {
      low = bars[i].low
      idx = i
    }
  }
  return { idx, low }
}

function maxHigh(bars: OhlcvBar[], from: number, to: number) {
  let idx = from
  let high = bars[from].high
  for (let i = from + 1; i <= to; i++) {
    if (bars[i].high > high) {
      high = bars[i].high
      idx = i
    }
  }
  return { idx, high }
}

/**
 * Confirmed swings use a 3-bar wing (no peeking past lastIdx - wing).
 * The last coil may extend to the last completed bar (live pivot = max high in that window).
 */
export function findCoils(bars: OhlcvBar[], lookback = 65, wing = 3): Coil[] {
  if (bars.length < lookback / 2) return []
  const end = bars.length - 1
  const start = Math.max(wing, end - lookback + 1)
  const confirmedUntil = Math.max(start, end - wing)
  const highIdxs: number[] = []
  for (let i = start; i <= confirmedUntil; i++) {
    if (isLocalHigh(bars, i, wing, confirmedUntil)) highIdxs.push(i)
  }
  if (!highIdxs.length) return []

  const coils: Coil[] = []
  for (let h = 0; h < highIdxs.length; h++) {
    const highI = highIdxs[h]
    const nextHigh = highIdxs[h + 1]
    const searchEnd = nextHigh != null ? nextHigh : end
    if (searchEnd <= highI + 2) continue
    const lowSearchFrom = highI + 1
    const confirmedLowUntil = nextHigh != null ? Math.min(nextHigh, confirmedUntil) : confirmedUntil
    let lowI: number
    let low: number
    if (nextHigh != null) {
      const found = minLow(bars, lowSearchFrom, searchEnd)
      lowI = found.idx
      low = found.low
      if (confirmedLowUntil - lowSearchFrom >= wing * 2) {
        let best: number | null = null
        for (let i = lowSearchFrom; i <= confirmedLowUntil; i++) {
          if (isLocalLow(bars, i, wing, confirmedLowUntil) && (best == null || bars[i].low < bars[best].low)) {
            best = i
          }
        }
        if (best != null) {
          lowI = best
          low = bars[best].low
        }
      }
    } else {
      const found = minLow(bars, lowSearchFrom, end)
      lowI = found.idx
      low = found.low
    }
    const high = bars[highI].high
    if (!(high > 0) || !(low > 0) || low >= high) continue
    const depth = (high - low) / high
    const span = lowI - highI + 1
    if (span < 3) continue
    coils.push({ highIdx: highI, lowIdx: lowI, high, low, depth, span })
  }

  const last = coils.slice(-6)
  return last
}

export function vcpProgression(coils: Coil[]): { ok: boolean; reason: string | null } {
  if (coils.length < 2) return { ok: false, reason: "Need two or more contractions." }
  if (coils.length > 6) return { ok: false, reason: "More than six contractions is a messy base." }
  for (let i = 1; i < coils.length; i++) {
    if (coils[i].depth > coils[i - 1].depth * 0.85 + 1e-9) {
      return { ok: false, reason: "A later contraction is not tighter (need each ≤ 85% of the prior)." }
    }
  }
  const last = coils[coils.length - 1]
  if (last.depth < 0.02) return { ok: false, reason: "Last coil is a dead box (<2%)." }
  if (last.depth > 0.08) return { ok: false, reason: "Last coil is wider than 8%." }
  if (last.span < 5 || last.span > 25) return { ok: false, reason: "Last coil is not 5–25 sessions." }
  return { ok: true, reason: null }
}

export function lastCoilPivot(bars: OhlcvBar[], coil: Coil) {
  const from = coil.highIdx
  const to = Math.max(coil.highIdx, coil.lowIdx)
  return maxHigh(bars, from, to)
}
