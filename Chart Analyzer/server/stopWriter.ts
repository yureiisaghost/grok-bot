import type { OhlcvBar } from "../src/types"
import { roundPx } from "./indicators"

export type StopWrite =
  | { ok: true; stop: number; inside: number }
  | { ok: false; reason: "too_tight" | "too_wide"; stop: number; inside: number }

/** Most recent bar in the last 8 of the box whose low is above the structural low. */
export function lastHigherLow(
  bars: OhlcvBar[],
  boxStart: number,
  boxEnd: number,
  structural: number,
) {
  if (!bars.length) return structural
  const end = Math.min(bars.length - 1, boxEnd)
  if (end < 0) return structural
  const start = Math.max(0, Math.min(boxStart, end), end - 7)
  let found: number | null = null
  for (let j = start; j <= end; j++) {
    if (bars[j].low > structural) found = bars[j].low
  }
  return found ?? structural
}

/**
 * Shared Candidate stop. Writes inside * 0.99 once.
 * atrCap / pctCap are floors the written stop must already clear.
 * A cavern structural low is Developing, not a raised 8% Candidate stop.
 */
export function writeStructuralStop(opts: {
  structural: number
  bars: OhlcvBar[]
  boxStart: number
  boxEnd: number
  trigger: number
  last: number
  atr: number | null
  adrPct?: number | null
  maxStopPct?: number
}): StopWrite {
  if (!opts.bars.length || !(opts.structural > 0) || !(opts.trigger > 0)) {
    return { ok: false, reason: "too_tight", stop: 0, inside: opts.structural }
  }
  const inside = lastHigherLow(opts.bars, opts.boxStart, opts.boxEnd, opts.structural)
  const stop = roundPx(inside * 0.99)
  if (!(opts.trigger > stop) || !(stop > 0)) {
    return { ok: false, reason: "too_tight", stop, inside }
  }
  const atr = opts.atr != null && opts.atr > 0 ? opts.atr : null
  if (atr != null && stop >= opts.trigger - 0.25 * atr) {
    return { ok: false, reason: "too_tight", stop, inside }
  }
  if (atr != null && stop < opts.trigger - 1.5 * atr) {
    return { ok: false, reason: "too_wide", stop, inside }
  }
  const pctCap = opts.maxStopPct != null && opts.maxStopPct > 0 ? opts.maxStopPct : 0.08
  if (opts.last > 0 && (opts.trigger - stop) / opts.last > pctCap) {
    return { ok: false, reason: "too_wide", stop, inside }
  }
  if (opts.last > 0 && opts.adrPct != null && opts.adrPct > 0) {
    if ((opts.trigger - stop) / opts.last > opts.adrPct / 100) {
      return { ok: false, reason: "too_wide", stop, inside }
    }
  }
  return { ok: true, stop, inside }
}

export function sessionRangePct(bars: OhlcvBar[], lookback: number, last: number) {
  if (!(last > 0) || bars.length < 2) return 0
  const slice = bars.slice(-lookback)
  let hi = -Infinity
  let lo = Infinity
  for (const bar of slice) {
    if (bar.high > hi) hi = bar.high
    if (bar.low < lo) lo = bar.low
  }
  if (!(hi >= lo) || !(lo > 0)) return 0
  return (hi - lo) / last
}
