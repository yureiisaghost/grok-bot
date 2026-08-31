import type { PlanOfAttack } from "../types"

export function isKeeper(plan: PlanOfAttack) {
  return plan.grade === "Candidate" || plan.grade === "Developing"
}

export function sortKeepers(plans: PlanOfAttack[]): PlanOfAttack[] {
  const rank = (plan: PlanOfAttack) => (plan.grade === "Candidate" ? 0 : 1)
  return [...plans].sort((a, b) => rank(a) - rank(b) || b.score - a.score || a.ticker.localeCompare(b.ticker))
}

export function eligibleKeepers(keepers: PlanOfAttack[], excluded: Set<string>) {
  return keepers.filter((plan) => isKeeper(plan) && !excluded.has(plan.ticker))
}

export function mixLabel(plans: PlanOfAttack[]) {
  const candidate = plans.filter((plan) => plan.grade === "Candidate").length
  const developing = plans.filter((plan) => plan.grade === "Developing").length
  return `${candidate} Candidate + ${developing} Developing`
}
