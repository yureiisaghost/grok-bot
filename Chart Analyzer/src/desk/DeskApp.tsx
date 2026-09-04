import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { ApiError, fetchDeskPlan, fetchDeskState, fetchHandoff, placePotentialOrder, refreshDesk, saveDeskSettings } from "../api"
import { GradeBadge } from "../components/GradeBadge"
import { PlanPanel } from "../components/PlanPanel"
import { PriceChart } from "../components/PriceChart"
import type { DeskPick, DeskPosition, DeskRegime, DeskSettings, DeskSnapshot, DeskWatch, HandoffManifest, PlanOfAttack } from "../types"
import { gapShort, px } from "../lib/ticket"

export interface DeskHandle {
  refresh: () => Promise<void>
}

type OrderStatus = "sending" | "queued" | "pending"

type DeskAppProps = {
  connected: boolean
  onNeedsAuth: (authUrl?: string | null) => void
  onRefreshed?: () => void
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function pct(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—"
  return `${n.toFixed(1)}%`
}

function regimeBannerClass(status: DeskRegime["status"] | undefined) {
  if (status === "open") return "banner ok"
  if (status === "pressure" || status === "blackout") return "banner warn"
  return "banner"
}

function queuedMap(tickers: string[] | undefined): Record<string, "queued"> {
  return Object.fromEntries((tickers ?? []).map((ticker) => [ticker, "queued" as const]))
}

function orderStateFrom(
  snapshot: DeskSnapshot | null,
  queuedTickers: string[] | undefined,
): Record<string, "queued" | "pending"> {
  const map: Record<string, "queued" | "pending"> = queuedMap(queuedTickers)
  for (const row of snapshot?.working ?? []) {
    map[row.ticker] = row.orderStatus === "pending" ? "pending" : "queued"
  }
  return map
}

function potentialRows(snapshot: DeskSnapshot) {
  const rows: { pick: DeskPick; kind: "pick" | "runner" }[] = []
  const seen = new Set<string>()
  for (const row of snapshot.working ?? []) {
    const ticker = row.ticker.toUpperCase()
    seen.add(ticker)
    const kind = snapshot.pick?.ticker.toUpperCase() === ticker ? "pick" : "runner"
    rows.push({ pick: row, kind })
  }
  if (snapshot.pick && !seen.has(snapshot.pick.ticker.toUpperCase())) {
    rows.push({ pick: snapshot.pick, kind: "pick" })
    seen.add(snapshot.pick.ticker.toUpperCase())
  }
  if (snapshot.runnerUp && !seen.has(snapshot.runnerUp.ticker.toUpperCase())) {
    rows.push({ pick: snapshot.runnerUp, kind: "runner" })
  }
  return rows
}

function regimeLabel(status: DeskRegime["status"]) {
  if (status === "open") return "Tape"
  if (status === "pressure") return "Tape — distribution pressure"
  if (status === "blackout") return "Tape — macro on calendar"
  if (status === "closed") return "Tape — QQQ 10/20 not stacked"
  return "Tape"
}

function PickCard({
  pick,
  kind,
  open,
  orderState,
  onOpen,
  onPlaceOrder,
}: {
  pick: DeskPick
  kind: "pick" | "runner"
  open?: boolean
  orderState?: "sending" | "queued" | "pending"
  onOpen?: (pick: DeskPick) => void
  onPlaceOrder?: (pick: DeskPick) => void
}) {
  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen?.(pick)
    }
  }
  const queued = orderState === "queued"
  const sending = orderState === "sending"
  const pending = orderState === "pending"
  return (
    <article
      className={`stock-card ${kind === "pick" ? "is-pick" : "is-runner"}${open ? " is-open" : ""}${queued ? " is-queued" : ""}${pending ? " is-pending" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${pick.ticker}, quality ${pick.qualityScore}. Open chart and plan.`}
      onClick={() => onOpen?.(pick)}
      onKeyDown={onKey}
    >
      <div className="stock-card-top">
        <div className="stock-card-ticker">{pick.ticker}</div>
        <div className="stock-card-score">{pick.qualityScore}</div>
      </div>
      <dl className="stock-card-levels">
        <div>
          <dt>Last</dt>
          <dd>{px(pick.lastPrice)}</dd>
        </div>
        <div>
          <dt>Entry</dt>
          <dd>{px(pick.entryPrice)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-stop">{px(pick.stopPrice)}</dd>
        </div>
        <div>
          <dt>1R</dt>
          <dd className="is-target">{px(pick.r1)}</dd>
        </div>
      </dl>
      <button
        className={`btn good stock-card-order${queued ? " is-queued" : ""}${pending ? " is-pending" : ""}`}
        type="button"
        disabled={sending || pending}
        aria-label={pending ? `${pick.ticker} pending at Robinhood` : queued ? `Queued ${pick.ticker} for Grok` : `Place order for ${pick.ticker}`}
        title={pending
          ? "Working buy is live at Robinhood."
          : "Write this ticket to Robinhood/Tickets. Wait for Yurei to say take."}
        onClick={(event) => {
          event.stopPropagation()
          if (pending) return
          onPlaceOrder?.(pick)
        }}
        onKeyDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {sending ? "Sending…" : pending ? "Pending" : queued ? "Queued" : "Place Order"}
      </button>
    </article>
  )
}

function RegimeBar({ regime }: { regime: DeskRegime }) {
  const sma = regime.qqqSma10 != null && regime.qqqSma20 != null
    ? `QQQ 10 ${regime.qqqSma10.toFixed(2)} / 20 ${regime.qqqSma20.toFixed(2)}`
    : "QQQ 10/20 n/a"
  const spy = regime.spyWeekly ? `SPY weekly ${regime.spyWeekly}` : "SPY weekly n/a"
  const macro = regime.nextMacro
    ? `Next ${regime.nextMacro.kind} ${regime.nextMacro.date}${regime.macroHit?.session === "prior" ? " · prior session" : ""}`
    : "No FOMC/CPI/NFP date on file"
  return (
    <div className={regimeBannerClass(regime.status)}>
      <strong>{regimeLabel(regime.status)}</strong>
      <div className="tiny" style={{ marginTop: 4 }}>
        {sma} · {regime.distributionDays} distribution days / 25 · {spy} · {macro}
      </div>
      <div style={{ marginTop: 6 }}>{regime.reason}</div>
    </div>
  )
}

function HeatBar({ open, pending = 0, max, leftover, slot, capPct }: { open: number; pending?: number; max: number; leftover: number; slot: number; capPct: number }) {
  const used = open + pending
  const usedPct = max > 0 ? Math.min(100, (used / max) * 100) : 0
  return (
    <section className="desk-heat">
      <div className="section-title">
        <h2>Heat (guidelines)</h2>
        <span className="tiny">{pct(max > 0 ? (used / max) * 100 : null)} of {capPct.toFixed(0)}% cap used</span>
      </div>
      <div
        className="heat-track"
        role="meter"
        aria-label="Open and pending heat versus max heat"
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(used)}
      >
        <div className="heat-fill" style={{ width: `${usedPct}%` }} />
      </div>
      <dl className="kpi-row">
        <div className="kpi"><dt>Open</dt><dd>{money(open)}</dd></div>
        {pending > 0 && <div className="kpi"><dt>Pending</dt><dd>{money(pending)}</dd></div>}
        <div className="kpi"><dt>Leftover</dt><dd>{money(leftover)}</dd></div>
        <div className="kpi"><dt>1R slot</dt><dd>{money(slot)}</dd></div>
        <div className="kpi"><dt>Cap</dt><dd>{money(max)}</dd></div>
      </dl>
    </section>
  )
}

function HeldCard({
  pos,
  open,
  filled,
  onOpen,
}: {
  pos: DeskPosition
  open?: boolean
  filled?: boolean
  onOpen?: (ticker: string) => void
}) {
  const pnl = pos.openPnl ?? (
    pos.lastPrice != null && pos.avgCost != null
      ? (pos.lastPrice - pos.avgCost) * pos.quantity
      : null
  )
  const pnlClass = pnl == null ? "" : pnl >= 0 ? "is-up" : "is-down"
  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen?.(pos.ticker)
    }
  }
  return (
    <article
      className={`stock-card is-held${open ? " is-open" : ""}${filled ? " is-filled" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${pos.ticker} open position. Open chart and plan.`}
      onClick={() => onOpen?.(pos.ticker)}
      onKeyDown={onKey}
    >
      <div className="stock-card-top">
        <div className="stock-card-ticker">{pos.ticker}</div>
        <div className="stock-card-score">{px(pos.lastPrice)}</div>
      </div>
      <dl className="stock-card-levels">
        <div>
          <dt>Entry</dt>
          <dd>{px(pos.avgCost)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-stop">{px(pos.stopPrice)}</dd>
        </div>
        <div>
          <dt>Next R</dt>
          <dd className="is-target">{px(pos.nextRPrice)}</dd>
        </div>
        <div>
          <dt>Open P/L</dt>
          <dd className={pnlClass}>{pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${money(pnl)}`}</dd>
        </div>
      </dl>
    </article>
  )
}

function WatchCard({
  item,
  open,
  onOpen,
}: {
  item: DeskWatch
  open?: boolean
  onOpen?: (ticker: string) => void
}) {
  function onKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      onOpen?.(item.ticker)
    }
  }
  return (
    <article
      className={`stock-card is-watch${open ? " is-open" : ""}`}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      aria-label={`${item.ticker} watchlist. Open chart and plan.`}
      onClick={() => onOpen?.(item.ticker)}
      onKeyDown={onKey}
    >
      <div className="stock-card-top">
        <div className="stock-card-ticker">{item.ticker}</div>
        <div className="stock-card-score">{item.qualityScore ?? "—"}</div>
      </div>
      <dl className="stock-card-levels">
        <div>
          <dt>Last</dt>
          <dd>{px(item.lastPrice)}</dd>
        </div>
        <div>
          <dt>Entry</dt>
          <dd>{px(item.entryPrice)}</dd>
        </div>
        <div>
          <dt>Stop</dt>
          <dd className="is-stop">{px(item.stopPrice)}</dd>
        </div>
        <div>
          <dt>1R</dt>
          <dd className="is-target">{px(item.r1)}</dd>
        </div>
      </dl>
    </article>
  )
}

function TicketDock({
  ticker,
  plan,
  loading,
  detailIn,
  detailRef,
  onClose,
}: {
  ticker: string | null
  plan: PlanOfAttack | null
  loading: boolean
  detailIn: boolean
  detailRef: { current: HTMLDivElement | null }
  onClose: () => void
}) {
  const ready = Boolean(plan && ticker && plan.ticker.toUpperCase() === ticker.toUpperCase())
  if (!loading && !ready) return null
  return (
    <>
      {loading && !ready && (
        <div className="banner ok">Loading {ticker} chart and plan…</div>
      )}
      {ready && plan && (
        <div
          ref={detailRef}
          className={`desk-ticket-shell${detailIn ? " is-in" : ""}`}
        >
          <div className="desk-ticket-clip">
            <TicketDetail plan={plan} onClose={onClose} />
          </div>
        </div>
      )}
    </>
  )
}

function TicketDetail({ plan, onClose }: { plan: PlanOfAttack; onClose: () => void }) {
  return (
    <div className="layout desk-ticket-detail">
      <div className="panel">
        <div className="quote-row">
          <div>
            <div className="quote-id">
              <div className="quote-ticker">{plan.ticker}</div>
              {!plan.heldChart && <GradeBadge grade={plan.grade} size="lg" />}
            </div>
            <div className="quote-name">{plan.name} · {plan.setupType}</div>
          </div>
          <div className="quote-px-wrap">
            <div className={`quote-px ${plan.changePct >= 0 ? "is-up" : "is-down"}`}>
              {money(plan.lastPrice)}
            </div>
            <div className={`tiny ${plan.changePct >= 0 ? "is-up" : "is-down"}`} style={{ textAlign: "right" }}>
              {plan.changePct >= 0 ? "+" : ""}{plan.changePct.toFixed(2)}% · weekly {plan.weeklyTrend}
            </div>
          </div>
        </div>
        <PriceChart plan={plan} />
        <dl className="kpi-row">
          <div className="kpi"><dt>Entry</dt><dd>{px(plan.entryPrice)}</dd></div>
          <div className="kpi"><dt>Stop</dt><dd>{px(plan.stopPrice)}</dd></div>
          <div className="kpi"><dt>R1</dt><dd>{px(plan.r1)}</dd></div>
          <div className="kpi"><dt>To level</dt><dd>{gapShort(plan)}</dd></div>
        </dl>
        {plan.heldChart && plan.plan && (
          <p className="tiny" style={{ marginTop: 10 }}>{plan.plan}</p>
        )}
        <div className="panel-actions" style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={onClose}>Close chart</button>
        </div>
      </div>
      {!plan.heldChart && <PlanPanel plan={plan} />}
    </div>
  )
}

function DrivePack({ pack }: { pack: HandoffManifest | null }) {
  const folders = pack?.folders?.length ? pack.folders : [
    { drive: "handoff/ACTIVE-SESSION.md", kind: "Phone Grok reads this first — live cash book" },
    { drive: "handoff/ACTIVE-SESSION.json", kind: "Machine session (placeCashOrders)" },
    { drive: "handoff/DESK-BRIEF.md", kind: "Local leftover — not the book" },
    { drive: "handoff/GROK-HANDOFF.json", kind: "Exact file list for Bot to upload" },
    { drive: "desk-data/scans/", kind: "Full keeper list + .active-scan.json" },
    { drive: "desk-data/regime.json", kind: "Tape card (QQQ/SPY/IWM) — not a trading lock" },
    { drive: "desk-data/watches.json", kind: "Carry watches Phone maintains" },
    { drive: "desk-data/last-refresh.json", kind: "Local desk snapshot — not Phone's book" },
    { drive: "desk-data/account.json", kind: "Short equity/heat summary" },
    { drive: "desk-data/settings.json", kind: "Heat guidelines" },
    { drive: "Robinhood/Tickets/", kind: "Cash tickets after Yurei says take — not the scan pack" },
    { drive: "Robinhood/Filled/", kind: "Filled tickets" },
    { drive: "Robinhood/Stale/", kind: "Dead / skipped tickets" },
  ]
  return (
    <details className="desk-drive" open>
      <summary>Google Drive pack</summary>
      <p className="tiny" style={{ marginTop: 8 }}>
        Upload into Drive folder <strong>Grok Trading/</strong> using the same relative paths.
        Phone Grok reads Bot’s full keeper list plus the live Robinhood cash book. Tape is color, not a lock.
      </p>
      <p className="tiny"><strong>Where each kind of file goes</strong></p>
      <ul className="drive-list">
        {folders.map((row) => (
          <li key={row.drive}>
            <code>Grok Trading/{row.drive}</code>
            <span> · {row.kind}</span>
          </li>
        ))}
      </ul>
      <p className="tiny"><strong>Files on this machine now</strong>{pack ? ` · ${pack.uploads.length} · ${pack.generatedAt}` : ""}</p>
      {pack && pack.uploads.length > 0 ? (
        <ul className="drive-list">
          {pack.uploads.map((row) => (
            <li key={row.local}>
              <code>{row.local}</code>
              <span> → <code>Grok Trading/{row.drive}</code> · {row.kind}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny">Run <code>npm run scan</code> or click Refresh to write the pack. Bot reads <code>handoff/GROK-HANDOFF.json</code> for this list.</p>
      )}
      <p className="tiny">Never upload OAuth tokens, <code>node_modules</code>, <code>.env</code>, or Drive <code>(1)</code> copies.</p>
    </details>
  )
}

export const DeskApp = forwardRef<DeskHandle, DeskAppProps>(function DeskApp({ connected, onNeedsAuth, onRefreshed }, ref) {
  const [settings, setSettings] = useState<DeskSettings>({
    riskPct: 1,
    maxHeatPct: 6,
    maxNewNames: 2,
    bookMode: "live",
    paperStartingCash: 1000,
  })
  const [snapshot, setSnapshot] = useState<DeskSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [openTicker, setOpenTicker] = useState<string | null>(null)
  const [openPlan, setOpenPlan] = useState<PlanOfAttack | null>(null)
  const [openLoading, setOpenLoading] = useState(false)
  const [detailIn, setDetailIn] = useState(false)
  const [orderState, setOrderState] = useState<Partial<Record<string, OrderStatus>>>({})
  const [handoff, setHandoff] = useState<HandoffManifest | null>(null)
  const planCache = useRef<Record<string, PlanOfAttack>>({})
  const detailRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<number>(0)

  function loadHandoff() {
    void fetchHandoff().then(setHandoff).catch(() => {})
  }

  const onRefresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const next = await refreshDesk()
      setSettings(next.settings)
      setSnapshot(next.snapshot)
      setOrderState(orderStateFrom(next.snapshot, next.queuedTickers))
      planCache.current = {}
      setOpenTicker(null)
      setOpenPlan(null)
      setDetailIn(false)
      const scan = next.snapshot?.scan
      const filled = next.snapshot?.filledFromQueue ?? []
      const pending = (next.snapshot?.working ?? []).filter((row) => row.orderStatus === "pending").map((row) => row.ticker)
      const bits: string[] = []
      if (next.snapshot?.usedNewList) {
        bits.push(scan?.fileName ? `Loaded new list ${scan.fileName}.` : "Loaded a new keeper list.")
      } else if (!scan?.fileName) {
        bits.push("No new list. Book was still refreshed.")
      } else {
        bits.push(`No new list — re-scored ${scan.fileName} against the live book.`)
      }
      if (filled.length) bits.push(`${filled.join(", ")} filled — now in Open positions.`)
      if (pending.length) {
        bits.push(`${pending.join(", ")} pending at Robinhood.`)
      }
      bits.push("Handoff pack ready in handoff/.")
      setNotice(bits.join(" "))
      loadHandoff()
      onRefreshed?.()
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_auth") {
        onNeedsAuth(err.authUrl)
        setError(err.message)
        return
      }
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [onNeedsAuth, onRefreshed])

  useImperativeHandle(ref, () => ({ refresh: onRefresh }), [onRefresh])

  useEffect(() => {
    let cancelled = false
    void fetchDeskState().then((state) => {
      if (cancelled) return
      setSettings(state.settings)
      setSnapshot(state.snapshot)
      setOrderState(orderStateFrom(state.snapshot, state.queuedTickers))
      setHydrated(true)
      loadHandoff()
    }).catch((err: unknown) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
      setHydrated(true)
    })
    return () => { cancelled = true }
  }, [])

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault()
    try {
      const next = await saveDeskSettings(settings)
      setSettings(next.settings)
      setSnapshot(next.snapshot)
      setOrderState(orderStateFrom(next.snapshot, next.queuedTickers))
      setNotice("Risk rules saved. Click Refresh to re-allocate.")
      loadHandoff()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  function closeDetail() {
    setDetailIn(false)
    setOpenTicker(null)
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpenPlan(null), 260)
  }

  async function onOpenTicker(ticker: string) {
    if (openTicker === ticker) {
      closeDetail()
      return
    }
    window.clearTimeout(closeTimer.current)
    setOpenTicker(ticker)
    setError(null)
    const cached = planCache.current[ticker]
    if (cached) {
      setOpenPlan(cached)
      return
    }
    setOpenLoading(true)
    try {
      const plan = await fetchDeskPlan(ticker)
      planCache.current[ticker] = plan
      setOpenPlan(plan)
    } catch (err) {
      setOpenTicker(null)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setOpenLoading(false)
    }
  }

  async function onOpenCard(pick: DeskPick) {
    await onOpenTicker(pick.ticker)
  }

  async function onPlaceOrder(pick: DeskPick) {
    setError(null)
    setOrderState((prev) => ({ ...prev, [pick.ticker]: "sending" }))
    try {
      const result = await placePotentialOrder(pick.ticker)
      try {
        const next = await fetchDeskState()
        setSettings(next.settings)
        setSnapshot(next.snapshot)
        setOrderState(orderStateFrom(next.snapshot, next.queuedTickers))
      } catch {
        setOrderState((prev) => ({ ...prev, [pick.ticker]: "queued" }))
      }
      setNotice(`Queued ${result.ticker} for Grok in ${result.driveFolder}.`)
      loadHandoff()
    } catch (err) {
      setOrderState((prev) => {
        const next = { ...prev }
        delete next[pick.ticker]
        return next
      })
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!openPlan || !openTicker) return
    const frame = requestAnimationFrame(() => setDetailIn(true))
    return () => cancelAnimationFrame(frame)
  }, [openPlan, openTicker])

  useEffect(() => {
    if (!detailIn || !openPlan) return
    detailRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }, [detailIn, openPlan])

  useEffect(() => () => window.clearTimeout(closeTimer.current), [])

  const book = snapshot?.book
  const regime = snapshot?.regime
  const heldOpen = Boolean(
    openTicker && snapshot?.positions.some((pos) => pos.ticker.toUpperCase() === openTicker.toUpperCase()),
  )
  const watchOpen = Boolean(
    openTicker && snapshot?.nextUp.some((item) => item.ticker.toUpperCase() === openTicker.toUpperCase()),
  )

  return (
    <div className="desk">
      {error && <div className="banner">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {loading && <div className="banner ok">Refreshing the book…</div>}

      {!connected && (
        <div className="empty">
          <strong>Connect Robinhood for quotes and tape</strong>
          Tokens stay on this PC. Refresh sizes leftover heat against the keeper list.
        </div>
      )}

      {connected && hydrated && !snapshot && !loading && (
        <div className="empty">
          <strong>Click Refresh</strong>
          It will pull the index tape, your account, and any keeper list — then return a ticket, or the rule that said no.
        </div>
      )}

      {regime && <RegimeBar regime={regime} />}

      {book && (
        <section className="desk-book">
          <div className="section-title">
            <h2>Book</h2>
            <span className="tiny">
              {snapshot?.refreshedAt}
              {snapshot?.scan?.fileName ? ` · ${snapshot.scan.fileName}` : ""}
              {snapshot?.usedNewList ? " · new list" : ""}
            </span>
          </div>
          <dl className="kpi-row">
            <div className="kpi"><dt>Equity</dt><dd>{money(book.equity)}</dd></div>
            <div className="kpi"><dt>Cash</dt><dd>{money(book.cash)}</dd></div>
            <div className="kpi"><dt>Buying power</dt><dd>{money(book.buyingPower)}</dd></div>
          </dl>
        </section>
      )}

      {book && (
        <HeatBar
          open={book.openHeat}
          pending={book.pendingHeat ?? 0}
          max={book.maxHeat}
          leftover={book.remainingHeat}
          slot={book.perNameRisk}
          capPct={book.equity > 0 ? (book.maxHeat / book.equity) * 100 : settings.maxHeatPct}
        />
      )}

      {snapshot && snapshot.positions.length > 0 && (
        <section className="desk-cards">
          <div className="section-title"><h2>Open positions</h2></div>
          <div className="ticket-row">
            {snapshot.positions.map((pos) => (
              <HeldCard
                key={pos.ticker}
                pos={pos}
                open={openTicker === pos.ticker}
                filled={(snapshot.filledFromQueue ?? []).some((ticker) => ticker.toUpperCase() === pos.ticker.toUpperCase())}
                onOpen={(ticker) => void onOpenTicker(ticker)}
              />
            ))}
          </div>
          {heldOpen && (
            <TicketDock
              ticker={openTicker}
              plan={openPlan}
              loading={openLoading}
              detailIn={detailIn}
              detailRef={detailRef}
              onClose={closeDetail}
            />
          )}
        </section>
      )}

      {((snapshot?.pick || snapshot?.runnerUp) || (snapshot?.working?.length ?? 0) > 0) && (
        <section className="desk-cards">
          <div className="section-title">
            <h2>Potential</h2>
          </div>
          <div className="ticket-row">
          {snapshot && potentialRows(snapshot).map((row) => (
            <PickCard
              key={row.pick.ticker}
              pick={row.pick}
              kind={row.kind}
              open={openTicker === row.pick.ticker}
              orderState={orderState[row.pick.ticker]}
              onOpen={(item) => void onOpenCard(item)}
              onPlaceOrder={(item) => void onPlaceOrder(item)}
            />
          ))}
          </div>
          {!heldOpen && !watchOpen && (
            <TicketDock
              ticker={openTicker}
              plan={openPlan}
              loading={openLoading}
              detailIn={detailIn}
              detailRef={detailRef}
              onClose={closeDetail}
            />
          )}
        </section>
      )}

      {snapshot && !snapshot.pick && snapshot.nothingReason && !(snapshot.working?.length) && snapshot.nextUp.length === 0 && (
        <div className="empty">
          <strong>{snapshot.nothingStep != null ? `Nothing to take · step ${snapshot.nothingStep}` : "Nothing to take"}</strong>
          {snapshot.nothingReason}
        </div>
      )}

      {snapshot && snapshot.nextUp.length > 0 && (
        <section className="desk-cards">
          <div className="section-title"><h2>Watchlist</h2></div>
          <div className="ticket-row">
            {snapshot.nextUp.map((item) => (
              <WatchCard
                key={item.ticker}
                item={item}
                open={openTicker === item.ticker}
                onOpen={(ticker) => void onOpenTicker(ticker)}
              />
            ))}
          </div>
          {watchOpen && (
            <TicketDock
              ticker={openTicker}
              plan={openPlan}
              loading={openLoading}
              detailIn={detailIn}
              detailRef={detailRef}
              onClose={closeDetail}
            />
          )}
        </section>
      )}

      {snapshot && snapshot.skippedCount > 0 && (
        <details className="desk-skipped">
          <summary>{snapshot.skippedCount} names not the pick</summary>
          <ul>
            {snapshot.skipped.map((item) => (
              <li key={`${item.ticker}-${item.reason}`}><strong>{item.ticker}</strong> · {item.reason}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="desk-rules-wrap">
        <summary>Risk rules (1% / 6% / max 2)</summary>
        <form className="desk-rules" onSubmit={(e) => void onSaveSettings(e)}>
          <label>
            Per name
            <input
              type="number"
              step="0.25"
              min="0.25"
              max="5"
              value={settings.riskPct}
              onChange={(e) => setSettings((s) => ({ ...s, riskPct: Number(e.target.value) }))}
            />
            %
          </label>
          <label>
            Max heat
            <input
              type="number"
              step="0.5"
              min="1"
              max="20"
              value={settings.maxHeatPct}
              onChange={(e) => setSettings((s) => ({ ...s, maxHeatPct: Number(e.target.value) }))}
            />
            %
          </label>
          <label>
            Max new
            <input
              type="number"
              step="1"
              min="1"
              max="5"
              value={settings.maxNewNames}
              onChange={(e) => setSettings((s) => ({ ...s, maxNewNames: Number(e.target.value) }))}
            />
          </label>
          <button className="btn" type="submit">Save rules</button>
        </form>
      </details>

      <DrivePack pack={handoff} />
    </div>
  )
})
