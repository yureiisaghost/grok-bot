import { GradeBadge } from "./GradeBadge"
import type { PlanOfAttack } from "../types"

export function ReviewStrip({
  keepers,
  selected,
  excluded,
  onSelect,
}: {
  keepers: PlanOfAttack[]
  selected: string | null
  excluded: Set<string>
  onSelect: (ticker: string) => void
}) {
  if (!keepers.length) return null
  return (
    <div className="review-strip" role="list">
      {keepers.map((plan) => {
        const off = excluded.has(plan.ticker)
        return (
          <button
            key={plan.ticker}
            type="button"
            role="listitem"
            className={`review-card${selected === plan.ticker ? " is-current" : ""}${off ? " is-off" : ""}`}
            onClick={() => onSelect(plan.ticker)}
          >
            <span className="review-sym">{plan.ticker}</span>
            <GradeBadge grade={plan.grade} />
            <span className="tiny">{plan.score}</span>
          </button>
        )
      })}
    </div>
  )
}
