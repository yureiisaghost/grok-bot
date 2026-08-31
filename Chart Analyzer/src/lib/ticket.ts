import type { PlanOfAttack } from "../types"

export function px(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—"
  return `$${n.toFixed(2)}`
}

export function gapShort(plan: PlanOfAttack) {
  const pct = plan.geometry?.pctToLevel
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return "—"
  if (Math.abs(pct) < 0.2) return "At level"
  return pct > 0 ? `${pct.toFixed(1)}% under` : `${Math.abs(pct).toFixed(1)}% over`
}
