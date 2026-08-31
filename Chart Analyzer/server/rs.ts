export function roc(closes: number[], n: number): number | null {
  if (closes.length <= n) return null
  const prev = closes[closes.length - 1 - n]
  const last = closes[closes.length - 1]
  if (!(prev > 0) || !(last > 0)) return null
  return last / prev - 1
}

/** IBD-style raw: 0.4×ROC63 + 0.2×ROC126 + 0.2×ROC189 + 0.2×ROC252. Null if &lt;252 days. */
export function rsRaw(closes: number[]): number | null {
  const r63 = roc(closes, 63)
  const r126 = roc(closes, 126)
  const r189 = roc(closes, 189)
  const r252 = roc(closes, 252)
  if (r63 == null || r126 == null || r189 == null || r252 == null) return null
  return 0.4 * r63 + 0.2 * r126 + 0.2 * r189 + 0.2 * r252
}

export function beatsSpy(tickerCloses: number[], spyCloses: number[] | undefined, n = 63): boolean | null {
  if (!spyCloses?.length) return null
  const t = roc(tickerCloses, n)
  const s = roc(spyCloses, n)
  if (t == null || s == null) return null
  return t > s
}
