export function last(values: Array<number | null | undefined>) {
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v !== null && v !== undefined && Number.isFinite(v)) return v
  }
  return null
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (period <= 0) return out
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = Array(values.length).fill(null)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  out[period - 1] = prev
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = Array(closes.length).fill(null)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  let avgGain = gain / period
  let avgLoss = loss / period
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const g = diff > 0 ? diff : 0
    const l = diff < 0 ? -diff : 0
    avgGain = (avgGain * (period - 1) + g) / period
    avgLoss = (avgLoss * (period - 1) + l) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

export function atr(highs: number[], lows: number[], closes: number[], period = 14): Array<number | null> {
  const tr: number[] = [highs[0] - lows[0]]
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1]),
    ))
  }
  return sma(tr, period)
}

export function highest(values: number[], end: number, lookback: number) {
  const start = Math.max(0, end - lookback + 1)
  let max = -Infinity
  for (let i = start; i <= end; i++) max = Math.max(max, values[i])
  return max
}

export function lowest(values: number[], end: number, lookback: number) {
  const start = Math.max(0, end - lookback + 1)
  let min = Infinity
  for (let i = start; i <= end; i++) min = Math.min(min, values[i])
  return min
}

export function slope(series: Array<number | null>, lookback = 5) {
  const a = last(series.slice(0, Math.max(0, series.length - lookback)))
  const b = last(series)
  if (a === null || b === null) return 0
  return (b - a) / a
}

export function roundPx(value: number) {
  if (value >= 10) return Math.round(value * 100) / 100
  if (value >= 1) return Math.round(value * 1000) / 1000
  return Math.round(value * 10000) / 10000
}

export function pct(from: number, to: number) {
  if (!from) return 0
  return ((to - from) / from) * 100
}

export function daysUntil(isoDate: string | null) {
  if (!isoDate) return null
  const target = new Date(`${isoDate}T00:00:00`)
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target.getTime() - start.getTime()) / 86_400_000)
}
