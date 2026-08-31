import { px } from "../lib/ticket"
import type { PlanOfAttack } from "../types"

function money(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a"
  return `$${n.toFixed(2)}`
}

export function PlanPanel({
  plan,
  saving = false,
  saved = false,
  excluded,
  onSave,
  onToggleExclude,
}: {
  plan: PlanOfAttack
  saving?: boolean
  saved?: boolean
  excluded?: boolean
  onSave?: () => void
  onToggleExclude?: () => void
}) {
  return (
    <div className="panel">
      <div className="section-title">
        <h2>Plan of Attack</h2>
        {(onSave || onToggleExclude) && (
        <div className="panel-actions">
          {onToggleExclude && (
            <button className="btn" type="button" onClick={onToggleExclude}>
              {excluded ? "Include" : "Exclude"}
            </button>
          )}
          {onSave && (
          <button
            className="btn good"
            type="button"
            onClick={onSave}
            disabled={saving || excluded || plan.grade === "Pass"}
            title={plan.grade === "Pass" ? "Pass is not written to the Desk list" : undefined}
          >
            {saving ? "Saving…" : saved ? "Saved" : "Save this one"}
          </button>
          )}
        </div>
        )}
      </div>
      <div className="ticket-strip">
        <div><span>Entry</span><strong>{px(plan.entryPrice)}</strong></div>
        <div><span>Stop</span><strong>{px(plan.stopPrice)}</strong></div>
        <div><span>Stop %</span><strong>{plan.stopPct != null && Number.isFinite(plan.stopPct) ? `${plan.stopPct.toFixed(1)}%` : "n/a"}</strong></div>
        <div><span>Stop ATR</span><strong>{plan.stopAtrMultiple != null && Number.isFinite(plan.stopAtrMultiple) ? `${plan.stopAtrMultiple.toFixed(2)}x` : "n/a"}</strong></div>
        <div><span>R1</span><strong>{px(plan.r1)}</strong></div>
        <div><span>R2</span><strong>{px(plan.r2)}</strong></div>
        <div><span>R3</span><strong>{px(plan.r3)}</strong></div>
        <div><span>Thrust 60d</span><strong>{plan.priorThrust60d != null && Number.isFinite(plan.priorThrust60d) ? `${plan.priorThrust60d.toFixed(0)}%` : "n/a"}</strong></div>
      </div>
      <dl className="kv">
        <div>
          <dt>Readiness</dt>
          <dd>{plan.readiness}</dd>
        </div>
        <div>
          <dt>1-share risk</dt>
          <dd>{money(plan.oneShareRisk ?? plan.sizing.dollarRisk)}</dd>
        </div>
        <div>
          <dt>Setup</dt>
          <dd>
            {plan.setupType} · first-pass {plan.score}
            {plan.qualityScore != null ? ` · quality ${plan.qualityScore}` : ""}
            {plan.flagRetracePct != null ? ` · flag retrace ${plan.flagRetracePct.toFixed(0)}%` : ""}
          </dd>
        </div>
        <div>
          <dt>Entry method</dt>
          <dd>{plan.entryMethod}</dd>
        </div>
        <div>
          <dt>Entry trigger</dt>
          <dd>{plan.entryTrigger}</dd>
        </div>
        <div>
          <dt>Stop / invalidation</dt>
          <dd>{plan.stop}<br />{plan.invalidation}</dd>
        </div>
        <div>
          <dt>Thesis</dt>
          <dd>{plan.thesis}</dd>
        </div>
        <div>
          <dt>Plan</dt>
          <dd>{plan.plan}</dd>
        </div>
        <div>
          <dt>Earnings</dt>
          <dd>{plan.earnings}{plan.earnDays !== null ? ` · ${plan.earnDays}d` : ""}</dd>
        </div>
        <div>
          <dt>Sizing</dt>
          <dd>{plan.sizing.note}</dd>
        </div>
        <div>
          <dt>Levels</dt>
          <dd>
            20 EMA {money(plan.levels.ema20)} · 50 EMA {money(plan.levels.ema50)} · SMA 50 {money(plan.levels.sma50)} · SMA 150 {money(plan.levels.sma150)} · SMA 200 {money(plan.levels.sma200)} · ADR {plan.levels.adrPct != null ? `${plan.levels.adrPct.toFixed(1)}%` : "n/a"} · scan-RS {plan.rsRaw != null ? plan.rsRaw.toFixed(2) : "n/a"} · vs SPY {plan.spyBeat == null ? "n/a" : plan.spyBeat ? "beats" : "lags"} · RSI {plan.levels.rsi14?.toFixed(1) ?? "n/a"} · ATR {plan.levels.atr14?.toFixed(2) ?? "n/a"} · Rel vol {plan.levels.relativeVolume == null ? "n/a" : `${plan.levels.relativeVolume.toFixed(2)}x`}
          </dd>
        </div>
      </dl>
      {plan.warnings.map((warning) => (
        <div className="banner warn" key={warning} style={{ marginTop: 12 }}>{warning}</div>
      ))}
      {plan.failedGates && plan.failedGates.length > 0 && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          Second pass: {plan.failedGates.join(", ")}. Not on the dock.
        </div>
      )}
      <p className="tiny" style={{ marginTop: 12 }}>
        Analyzed {plan.analyzedAt}. {onSave ? "Save writes to desk-data/scans for the Trade Desk." : "Saved screener plan. This desk does not place the order."}
      </p>
    </div>
  )
}
