import type { PlanOfAttack } from "../src/types"

const CORR_FLOOR = 0.70
const RETURN_DAYS = 20

export const CLUSTER_PCT = 0.02

export function clusterTag(plan: { industry?: string | null; sector?: string | null } | null | undefined) {
  const industry = plan?.industry?.trim()
  if (industry) return industry
  const sector = plan?.sector?.trim()
  if (sector) return sector
  return null
}

function tagKey(plan: { industry?: string | null; sector?: string | null } | null | undefined) {
  const tag = clusterTag(plan)
  return tag ? tag.toLowerCase() : null
}

export function dailyReturns(closes: number[] | undefined, days = RETURN_DAYS): number[] | null {
  if (!closes || closes.length < days + 1) return null
  const slice = closes.slice(-(days + 1))
  const out: number[] = []
  for (let i = 1; i < slice.length; i++) {
    if (!(slice[i - 1] > 0) || !(slice[i] > 0)) return null
    out.push(slice[i] / slice[i - 1] - 1)
  }
  return out
}

export function pearson(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 10) return null
  const n = a.length
  let sa = 0
  let sb = 0
  let sab = 0
  let sa2 = 0
  let sb2 = 0
  for (let i = 0; i < n; i++) {
    sa += a[i]
    sb += b[i]
    sab += a[i] * b[i]
    sa2 += a[i] * a[i]
    sb2 += b[i] * b[i]
  }
  const cov = sab - (sa * sb) / n
  const da = sa2 - (sa * sa) / n
  const db = sb2 - (sb * sb) / n
  if (!(da > 0) || !(db > 0)) return null
  return cov / Math.sqrt(da * db)
}

export function closesFromPlan(plan: PlanOfAttack | undefined): number[] | null {
  if (!plan?.chart?.length) return null
  const closes = plan.chart.map((bar) => bar.close)
  return closes.length ? closes : null
}

export function sameCluster(
  a: PlanOfAttack,
  b: { industry?: string | null; sector?: string | null; ticker?: string } | null | undefined,
  closesA?: number[] | null,
  closesB?: number[] | null,
): boolean {
  if (!b) return false
  if (a.ticker && b.ticker && a.ticker.toUpperCase() === b.ticker.toUpperCase()) return true
  const ka = tagKey(a)
  const kb = tagKey(b)
  if (ka && kb && ka === kb) return true
  const ra = dailyReturns(closesA ?? undefined)
  const rb = dailyReturns(closesB ?? undefined)
  if (!ra || !rb) return false
  const corr = pearson(ra, rb)
  return corr != null && corr > CORR_FLOOR
}

export function clusterHeatUsed(
  candidate: PlanOfAttack,
  peers: Array<{
    ticker: string
    heat: number
    industry?: string | null
    sector?: string | null
    closes?: number[] | null
  }>,
  candidateCloses: number[] | null,
): number {
  let used = 0
  for (const peer of peers) {
    if (sameCluster(candidate, peer, candidateCloses, peer.closes ?? null)) used += peer.heat
  }
  return used
}
