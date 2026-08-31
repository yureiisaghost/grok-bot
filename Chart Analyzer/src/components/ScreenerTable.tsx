import { useEffect, useMemo, useRef, useState } from "react"
import { GradeBadge } from "./GradeBadge"
import { scanCounts } from "../lib/scan"
import type { PlanOfAttack, ScanRow } from "../types"

type Filter = "all" | "queued" | "keepers" | "pass" | "failed"

function money(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function pct(n: number | null) {
  if (n === null || !Number.isFinite(n)) return "—"
  const sign = n > 0 ? "+" : ""
  return `${sign}${n.toFixed(1)}%`
}

function tone(n: number | null) {
  if (n === null || !Number.isFinite(n) || Math.abs(n) < 0.05) return ""
  return n > 0 ? " is-up" : " is-down"
}

function matches(row: ScanRow, filter: Filter) {
  if (filter === "all") return true
  if (filter === "queued") return row.status === "queued" || row.status === "running"
  if (filter === "keepers") return row.grade === "Candidate" || row.grade === "Developing"
  if (filter === "pass") return row.grade === "Pass"
  return row.status === "failed" || row.status === "skipped"
}

function statusLabel(row: ScanRow) {
  if (row.status === "running") return "Running"
  if (row.status === "queued") return "Queued"
  if (row.status === "failed") return row.failReason || "Failed"
  if (row.status === "skipped") {
    if (row.failReason === "price<5") return "Under $5 — not analyzed"
    return row.failReason || "Skipped"
  }
  if (row.grade === "Pass") return row.failReason || "Pass"
  return row.setupType || "—"
}

function scrollRowInPanel(panel: HTMLElement, row: HTMLElement) {
  const panelRect = panel.getBoundingClientRect()
  const rowRect = row.getBoundingClientRect()
  const head = panel.querySelector("thead")
  const headH = head ? head.getBoundingClientRect().height : 0
  const topBound = panelRect.top + headH + 4
  const bottomBound = panelRect.bottom - 4
  if (rowRect.top >= topBound && rowRect.bottom <= bottomBound) return
  const nextTop = panel.scrollTop + (rowRect.top - topBound) - Math.max(0, (panel.clientHeight - headH - rowRect.height) / 3)
  panel.scrollTop = Math.max(0, nextTop)
}

export function ScreenerTable({
  rows,
  plans,
  selected,
  followTicker,
  busy,
  onSelect,
  onRemove,
  onClearPending,
}: {
  rows: ScanRow[]
  plans?: Record<string, PlanOfAttack>
  selected: string | null
  followTicker?: string | null
  busy: boolean
  onSelect: (ticker: string) => void
  onRemove: (ticker: string) => void
  onClearPending: () => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [collapsed, setCollapsed] = useState(false)
  const counts = useMemo(() => scanCounts(rows, plans), [rows, plans])
  const visible = useMemo(() => rows.filter((row) => matches(row, filter)), [rows, filter])
  const complete = counts.total > 0 && counts.pending === 0 && counts.running === 0
  const wasComplete = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef<HTMLTableRowElement>(null)

  useEffect(() => {
    if (busy) {
      setCollapsed(false)
      setFilter("all")
      wasComplete.current = false
      return
    }
    if (complete && !wasComplete.current) setCollapsed(true)
    wasComplete.current = complete
  }, [busy, complete])

  useEffect(() => {
    if (!followTicker || collapsed) return
    const panel = scrollRef.current
    const row = followRef.current
    if (!panel || !row) return
    scrollRowInPanel(panel, row)
  }, [followTicker, collapsed, visible.length])

  if (!rows.length) return null

  const tabs: Array<{ id: Filter; label: string; n: number }> = [
    { id: "all", label: "All", n: counts.total },
    { id: "queued", label: "Queued", n: counts.queued + counts.running },
    { id: "keepers", label: "Keep", n: counts.keepers },
    { id: "pass", label: "Pass", n: counts.pass },
    { id: "failed", label: counts.skipped && counts.failed ? "Fail/skip" : counts.skipped ? "Skip" : "Failed", n: counts.failed + counts.skipped },
  ]

  return (
    <section className={`scan-board${collapsed ? " is-collapsed" : ""}`}>
      <div className="scan-head">
        <button
          type="button"
          className="scan-fold"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((open) => !open)}
        >
          <span className="scan-chevron" aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          <span>
            <span className="section-title" style={{ marginBottom: 4 }}>
              <h2>Screener</h2>
            </span>
            <span className="tiny">
              {counts.total} names · {counts.keepers} keep · {counts.pass} pass · {counts.pending} left to grade
              {counts.skipped ? ` · ${counts.skipped} skipped under $5` : ""}
              {counts.missingPlans ? ` · ${counts.missingPlans} missing chart` : ""}
              {followTicker ? ` · now ${followTicker}` : ""}
            </span>
          </span>
        </button>
        <div className="scan-head-actions">
          {!collapsed && (
            <>
              <div className="scan-tabs">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`scan-tab${filter === tab.id ? " is-on" : ""}`}
                    onClick={() => setFilter(tab.id)}
                  >
                    {tab.label} {tab.n}
                  </button>
                ))}
              </div>
              {counts.pending > 0 && (
                <button className="btn" type="button" disabled={busy} onClick={onClearPending}>
                  Clear queued
                </button>
              )}
            </>
          )}
          <button
            className="btn"
            type="button"
            onClick={() => setCollapsed((open) => !open)}
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </div>
      {!collapsed && (
      <div className="scan-scroll" ref={scrollRef}>
        <table className="scan-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Name</th>
              <th>Price</th>
              <th>1D</th>
              <th>1W</th>
              <th>Grade</th>
              <th>Setup</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const canRemove = !busy && (row.status === "queued" || row.status === "failed" || row.status === "skipped")
              const following = followTicker === row.ticker
              return (
                <tr
                  key={row.ticker}
                  ref={following ? followRef : undefined}
                  className={[
                    selected === row.ticker ? "is-current" : "",
                    row.status === "running" || following ? "is-running" : "",
                    row.grade === "Pass" ? "is-pass" : "",
                    row.status === "failed" || row.status === "skipped" ? "is-failed" : "",
                  ].filter(Boolean).join(" ")}
                  onClick={() => onSelect(row.ticker)}
                >
                  <td className="scan-sym">{row.ticker}</td>
                  <td className="scan-name" title={row.name ?? ""}>{row.name ?? "—"}</td>
                  <td>{money(row.price)}</td>
                  <td className={tone(row.change1d)}>{pct(row.change1d)}</td>
                  <td className={tone(row.perf1w)}>{pct(row.perf1w)}</td>
                  <td>
                    {row.status === "skipped" ? (
                      <span className="badge skip" title="CSV price under $5. Screener does not analyze these.">Skip</span>
                    ) : row.grade ? <GradeBadge grade={row.grade} /> : (
                      <span className="tiny">{row.status === "running" ? "…" : "—"}</span>
                    )}
                  </td>
                  <td className="scan-setup" title={row.failReason ?? row.setupType ?? ""}>
                    {statusLabel(row)}
                    {row.score !== null ? <span className="tiny"> · {row.score}</span> : null}
                  </td>
                  <td className="scan-x">
                    {canRemove && (
                      <button
                        type="button"
                        className="scan-remove"
                        title="Remove from queue"
                        onClick={(event) => {
                          event.stopPropagation()
                          onRemove(row.ticker)
                        }}
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="scan-empty">No names in this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      )}
    </section>
  )
}
