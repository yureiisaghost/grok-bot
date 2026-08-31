import { eligibleKeepers, mixLabel } from "../lib/batch"
import type { PlanOfAttack } from "../types"

export function SaveBatchBar({
  keepers,
  excluded,
  saving,
  onSave,
}: {
  keepers: PlanOfAttack[]
  excluded: Set<string>
  saving: boolean
  onSave: () => void
}) {
  const eligible = eligibleKeepers(keepers, excluded)
  if (!eligible.length) return null
  return (
    <div className="save-bar">
      <div>
        <div className="section-title" style={{ marginBottom: 6 }}>
          <h2>Save to the Desk</h2>
        </div>
        <p className="tiny">
          Writes every Candidate and Developing name into desk-data/scans. Refresh ranks the full list against your book. Pass never writes. Exclude a name first if you do not want it in the universe.
        </p>
      </div>
      <div className="save-sizes">
        <button
          className="btn primary"
          type="button"
          disabled={saving}
          title={mixLabel(eligible)}
          onClick={onSave}
        >
          {saving ? "Saving…" : `Save ${eligible.length} keepers`}
        </button>
      </div>
    </div>
  )
}
