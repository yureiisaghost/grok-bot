import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ApiError, analyzeTicker, clearQueue, fetchStatus, savePlan, savePlans } from "../api"
import { ConfirmModal } from "../components/ConfirmModal"
import { GradeBadge } from "../components/GradeBadge"
import { Header } from "../components/Header"
import { PlanPanel } from "../components/PlanPanel"
import { PriceChart } from "../components/PriceChart"
import { ReviewStrip } from "../components/ReviewStrip"
import { SaveBatchBar } from "../components/SaveBatchBar"
import { ScreenerTable } from "../components/ScreenerTable"
import { ScreenshotDrop, type Shot } from "../components/ScreenshotDrop"
import { eligibleKeepers, isKeeper, sortKeepers } from "../lib/batch"
import { clearSession, loadSession, persistToShot, saveSession, sessionHasWork, shotToPersist } from "../lib/persist"
import {
  applyPlanToRow,
  failRow,
  keeperPlans,
  mergeScanRows,
  migrateGrade,
  migratePlan,
  patchRow,
  isCheapCsvPrice,
  pendingTickers,
  recordFromPlans,
  rowsFromTickers,
  scanCounts,
  skipRow,
  tickerWithPlan,
} from "../lib/scan"
import { isScreenerCsv, readScreenerFiles } from "../lib/screener"
import { extractTickers, typedSymbols } from "../lib/tickers"
import { gapShort, px } from "../lib/ticket"
import type { AppStatus, BookMode, PlanOfAttack, QueueStatus, ScanRow } from "../types"

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" })
}

function newShot(file: File): Shot {
  return { id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`, file, url: URL.createObjectURL(file) }
}

function newScanId(): string {
  return crypto.randomUUID()
}

function savedFileLabel(meta: QueueStatus) {
  if (!meta.fileName) return "desk-data/scans"
  return meta.scan && meta.scan > 1 ? `${meta.fileName} (scan ${meta.scan})` : meta.fileName
}

function hydrateRows(session: { rows?: ScanRow[]; symbols?: string[]; keepers?: PlanOfAttack[]; tossed?: { ticker: string; reason: string }[]; plans?: PlanOfAttack[] }) {
  const restoredPlans = (session.plans?.length ? session.plans : (session.keepers ?? [])).map(migratePlan)
  let next = session.rows?.length
    ? session.rows
    : mergeScanRows(
      rowsFromTickers(session.symbols ?? [], "restored"),
      rowsFromTickers([
        ...restoredPlans.map((plan) => plan.ticker),
        ...(session.tossed ?? []).map((item) => item.ticker),
      ], "restored"),
    )
  for (const plan of restoredPlans) {
    next = next.map((row) => (row.ticker === plan.ticker ? applyPlanToRow(row, plan) : row))
  }
  for (const item of session.tossed ?? []) {
    next = next.map((row) => {
      if (row.ticker !== item.ticker || row.status !== "queued") return row
      if (item.reason === "Pass") {
        return { ...row, status: "graded", grade: "Pass", score: 0, setupType: "None", failReason: null }
      }
      return failRow(row, item.reason)
    })
  }
  return next.map((row) => ({ ...row, grade: migrateGrade(row.grade) }))
}

export default function ScreenerApp({ bookMode }: { bookMode: BookMode }) {
  const [connected, setConnected] = useState(false)
  const [queue, setQueue] = useState<QueueStatus | null>(null)
  const [book, setBook] = useState<AppStatus["book"] | null>(null)
  const [ticker, setTicker] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedTicker, setSavedTicker] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  const [shots, setShots] = useState<Shot[]>([])
  const [csvNames, setCsvNames] = useState<string[]>([])
  const [reading, setReading] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<string | null>(null)
  const [rows, setRows] = useState<ScanRow[]>([])
  const [plans, setPlans] = useState<Record<string, PlanOfAttack>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [excludedList, setExcludedList] = useState<string[]>([])
  const [running, setRunning] = useState(false)
  const [runStatus, setRunStatus] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const [scanId, setScanId] = useState(newScanId)

  const abortRef = useRef(false)
  const pinnedRef = useRef(false)
  const shownPlanRef = useRef<PlanOfAttack | null>(null)
  const userScrollY = useRef(0)
  const restoringScroll = useRef(false)
  const excluded = useMemo(() => new Set(excludedList), [excludedList])
  const keepers = useMemo(() => sortKeepers(keeperPlans(plans)), [plans])
  const counts = useMemo(() => scanCounts(rows, plans), [rows, plans])
  const typed = typedSymbols(ticker)
  const hasList = rows.length > 0 || typed.length > 1
  const remaining = pendingTickers(rows, plans).length + typed.filter((symbol) => !rows.some((row) => row.ticker === symbol)).length
  const resolved = selected && plans[selected] ? plans[selected] : null
  if (resolved) shownPlanRef.current = resolved
  const current = resolved ?? (running ? shownPlanRef.current : null)
  const persistWarn = useRef(false)
  const missingPlans = rows.filter((row) => row.status === "graded" && !plans[row.ticker]).length
  const scanTicker = rows.find((row) => row.status === "running")?.ticker ?? null

  async function refreshStatus() {
    const status = await fetchStatus()
    setConnected(status.connected)
    setQueue(status.queue)
    setBook(status.book)
  }

  useEffect(() => {
    void refreshStatus().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err))
    })
  }, [bookMode])

  useEffect(() => {
    let cancelled = false
    void loadSession().then((session) => {
      if (cancelled) return
      if (sessionHasWork(session) && session) {
        const nextRows = hydrateRows(session)
        const nextPlans = recordFromPlans((session.plans?.length ? session.plans : (session.keepers ?? [])).map(migratePlan))
        setRows(nextRows)
        setPlans(nextPlans)
        setExcludedList(session.excludedList)
        setTicker(session.ticker)
        setShots(session.shots.map(persistToShot))
        setCsvNames(session.csvNames ?? [])
        setScanId(session.scanId ?? newScanId())
        const pick = tickerWithPlan(nextPlans, session.selected)
          ?? nextRows.find((row) => row.grade === "Candidate" || row.grade === "Developing")?.ticker
          ?? null
        setSelected(pick)
        setNotice("Restored your last scan. New scan is the only way to start over.")
      }
      setHydrated(true)
    }).catch(() => {
      if (!cancelled) setHydrated(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const handle = window.setTimeout(() => {
      void saveSession({
        rows,
        plans: Object.values(plans),
        selected,
        excludedList,
        ticker,
        shots: shots.map(shotToPersist),
        csvNames,
        scanId,
      }).catch(() => {
        if (persistWarn.current) return
        persistWarn.current = true
        setNotice("This scan is too large to keep every chart in the browser. Candidate/Developing plans stay. Click a row to open the plan — Run All rebuilds any missing charts.")
      })
    }, 250)
    return () => window.clearTimeout(handle)
  }, [hydrated, rows, plans, selected, excludedList, ticker, shots, csvNames, scanId])

  useEffect(() => {
    if (running) return
    if (!Object.keys(plans).length) return
    if (selected && plans[selected]) return
    const next = tickerWithPlan(plans, selected)
    if (next) setSelected(next)
  }, [plans, selected, running])

  useEffect(() => {
    if (!running) return
    userScrollY.current = window.scrollY
    function onScroll() {
      if (restoringScroll.current) return
      userScrollY.current = window.scrollY
    }
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [running])

  useLayoutEffect(() => {
    if (!running) return
    const want = userScrollY.current
    if (Math.abs(window.scrollY - want) < 40) return
    restoringScroll.current = true
    window.scrollTo(0, want)
    restoringScroll.current = false
  })

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      if (!keepers.length || running) return
      const here = Math.max(0, keepers.findIndex((plan) => plan.ticker === selected))
      if (event.key === "ArrowRight") {
        event.preventDefault()
        setSelected(keepers[(here + 1) % keepers.length].ticker)
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault()
        setSelected(keepers[(here - 1 + keepers.length) % keepers.length].ticker)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [keepers, running, selected])

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA") return
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/") || isScreenerCsv(file))
      const text = event.clipboardData?.getData("text") ?? ""
      if (files.length) {
        event.preventDefault()
        void addFiles(files)
        return
      }
      const pasted = extractTickers(text)
      if (pasted.length >= 2) {
        event.preventDefault()
        setRows((currentRows) => mergeScanRows(currentRows, rowsFromTickers(pasted, "clipboard")))
        setNotice(`Added ${pasted.length} tickers from clipboard.`)
      }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [])

  function openAuth(authUrl: string | null | undefined) {
    if (authUrl) window.location.assign(authUrl)
  }

  async function addFiles(files: File[]) {
    const csvs = files.filter(isScreenerCsv)
    const images = files.filter((file) => file.type.startsWith("image/"))
    if (!csvs.length && !images.length) return

    setReading(true)
    setError(null)
    const notices: string[] = []
    try {
      if (csvs.length) {
        const result = await readScreenerFiles(csvs)
        setCsvNames((currentNames) => {
          const next = [...currentNames]
          for (const name of result.files) {
            if (!next.includes(name)) next.push(name)
          }
          return next
        })
        setRows((currentRows) => mergeScanRows(currentRows, result.rows))
        notices.push(
          `Loaded ${result.rows.length} names from ${result.files.join(", ")}. Review the table, then run the queue.`,
        )
      }

      if (images.length) {
        const added = images.map(newShot)
        setShots((currentShots) => [...currentShots, ...added])
        setOcrProgress(`Reading screenshot 0/${added.length}…`)
        const { readTickersFromImages } = await import("../lib/ocr")
        const result = await readTickersFromImages(added.map((shot) => shot.file), (done: number, total: number) => {
          setOcrProgress(`Reading screenshot ${done}/${total}…`)
        })
        setRows((currentRows) => mergeScanRows(currentRows, rowsFromTickers(result.tickers, "screenshot")))
        notices.push(
          result.tickers.length
            ? `Read ${result.tickers.length} symbols from ${added.length} screenshot${added.length === 1 ? "" : "s"}. Review the table, then run the queue.`
            : "No tickers found in that screenshot. Crop closer to the symbol column, or drop a TradingView CSV.",
        )
      }

      if (notices.length) setNotice(notices.join(" "))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setReading(false)
      setOcrProgress(null)
    }
  }

  function removeShot(id: string) {
    setShots((currentShots) => {
      const shot = currentShots.find((item) => item.id === id)
      if (shot) URL.revokeObjectURL(shot.url)
      return currentShots.filter((item) => item.id !== id)
    })
  }

  function absorbPlan(next: PlanOfAttack) {
    setPlans((currentPlans) => ({ ...currentPlans, [next.ticker]: next }))
    setRows((currentRows) => {
      const exists = currentRows.some((row) => row.ticker === next.ticker)
      const board = exists ? currentRows : mergeScanRows(currentRows, rowsFromTickers([next.ticker], "typed"))
      return board.map((row) => (row.ticker === next.ticker ? applyPlanToRow(row, next) : row))
    })
    setSelected(next.ticker)
  }

  async function onAnalyze(event?: { preventDefault(): void }) {
    event?.preventDefault()
    const incoming = typedSymbols(ticker)
    if (incoming.length > 1) {
      setRows((currentRows) => mergeScanRows(currentRows, rowsFromTickers(incoming, "typed")))
      setTicker("")
      setNotice(`Added ${incoming.length} tickers to the queue.`)
      return
    }
    const symbol = incoming[0] ?? ticker.trim().toUpperCase()
    if (!symbol) return
    setLoading(true)
    setError(null)
    setNotice(null)
    setSavedTicker(null)
    setSelected(symbol)
    try {
      const next = await analyzeTicker(symbol)
      absorbPlan(next)
      setTicker(next.ticker)
      setConnected(true)
    } catch (err) {
      if (err instanceof ApiError && err.code === "needs_auth") {
        setConnected(false)
        setError(err.message)
        openAuth(err.authUrl)
        return
      }
      setRows((currentRows) => {
        const exists = currentRows.some((row) => row.ticker === symbol)
        const board = exists ? currentRows : mergeScanRows(currentRows, rowsFromTickers([symbol], "typed"))
        return board.map((row) => (row.ticker === symbol ? failRow(row, err instanceof Error ? err.message : String(err)) : row))
      })
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  async function runQueue() {
    const incoming = typedSymbols(ticker)
    let board = incoming.length ? mergeScanRows(rows, rowsFromTickers(incoming, "typed")) : rows
    if (incoming.length) {
      setRows(board)
      setTicker("")
    }
    const localPlans = { ...plans }
    let prefilterCheap = 0
    const pending = pendingTickers(board, localPlans)
    const todo: string[] = []
    for (const symbol of pending) {
      const row = board.find((item) => item.ticker === symbol)
      if (row && isCheapCsvPrice(row)) {
        board = board.map((item) => (item.ticker === symbol ? skipRow(item, "price<5") : item))
        prefilterCheap += 1
        continue
      }
      todo.push(symbol)
    }
    if (prefilterCheap) setRows(board)
    if (!todo.length) {
      setNotice(
        prefilterCheap
          ? `Skipped ${prefilterCheap} names under $5 from the CSV. Nothing left to analyze.`
          : "No remaining tickers to analyze.",
      )
      return
    }
    abortRef.current = false
    pinnedRef.current = false
    let followed = selected
    const active = document.activeElement
    if (active instanceof HTMLElement) active.blur()
    userScrollY.current = window.scrollY
    setRunning(true)
    setError(null)
    setNotice(
      prefilterCheap
        ? `Skipping ${prefilterCheap} names under $5 (CSV price). Analyzing ${todo.length}.`
        : null,
    )
    try {
      for (let i = 0; i < todo.length; i++) {
        if (abortRef.current) {
          setNotice("Queue stopped.")
          break
        }
        const symbol = todo[i]
        setRunStatus(`${i + 1}/${todo.length} · ${symbol}`)
        board = patchRow(board, symbol, { status: "running" })
        setRows(board)
        try {
          const next = await analyzeTicker(symbol)
          setConnected(true)
          localPlans[next.ticker] = next
          board = board.map((row) => (row.ticker === next.ticker ? applyPlanToRow(row, next) : row))
          setPlans({ ...localPlans })
          setRows(board)
          if (!pinnedRef.current) {
            setSelected(next.ticker)
            followed = next.ticker
          }
        } catch (err) {
          if (err instanceof ApiError && err.code === "needs_auth") {
            setConnected(false)
            setError(err.message)
            openAuth(err.authUrl)
            board = patchRow(board, symbol, { status: "queued" })
            setRows(board)
            abortRef.current = true
            break
          }
          if (err instanceof ApiError && err.code === "unreachable") {
            board = patchRow(board, symbol, { status: "queued" })
            setRows(board)
            setError(err.message)
            setNotice("Queue paused. The analyzer server stopped, so remaining names were left queued.")
            abortRef.current = true
            break
          }
          board = board.map((row) => (row.ticker === symbol ? failRow(row, err instanceof Error ? err.message : String(err)) : row))
          setPlans({ ...localPlans })
          setRows(board)
        }
      }
      setPlans({ ...localPlans })
      setRows(board)
      if (!abortRef.current) {
        const done = scanCounts(board)
        const cheapBit = (prefilterCheap || done.skipped)
          ? ` Skipped ${prefilterCheap || done.skipped} under $5 from the CSV.`
          : ""
        setNotice(
          `Queue done. ${done.candidate} Candidate, ${done.developing} Developing, ${done.pass} Pass, ${done.failed} failed.${cheapBit} Click a row or cycle keepers with ← →, then save a batch.`,
        )
        if (!pinnedRef.current) {
          const pick = tickerWithPlan(localPlans, followed)
          if (pick) setSelected(pick)
        }
        if (done.failed > 0) {
          const sample = board
            .filter((row) => row.status === "failed")
            .slice(0, 5)
            .map((row) => `${row.ticker}: ${row.failReason}`)
            .join(" · ")
          setError(`${done.failed} tickers failed at Robinhood and were not graded. ${sample}`)
        }
      }
    } finally {
      setRunning(false)
      setRunStatus(null)
    }
  }

  async function onSave() {
    if (!current || !isKeeper(current) || excluded.has(current.ticker)) return
    setSaving(true)
    setError(null)
    try {
      const meta = await savePlan(current, scanId)
      setQueue(meta)
      setSavedTicker(current.ticker)
      setNotice(
        `Saved ${current.ticker}. ${meta.rawCount ?? "?"} keepers on file for the Desk in ${savedFileLabel(meta)}.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onSaveBatch() {
    const picked = eligibleKeepers(keepers, excluded)
    if (!picked.length) return
    setSaving(true)
    setError(null)
    try {
      const meta = await savePlans(picked, scanId)
      setQueue(meta)
      setSavedTicker(picked[0]?.ticker ?? null)
      setNotice(
        `Saved ${picked.length} keepers to the Desk in ${savedFileLabel(meta)}. Refresh ranks the full list.`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  async function onClear() {
    setClearing(true)
    setError(null)
    try {
      const result = await clearQueue()
      setQueue({ path: queue?.path ?? "", fileName: null, scan: null, day: null, tickerCount: 0, tickers: [], updatedAt: null, rawCount: null, finalistCount: null })
      setScanId(newScanId())
      setConfirmClear(false)
      setNotice(
        result.archivedTo
          ? "Archived the current scan into desk-data/scans/Archive."
          : "No scan file to archive.",
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setClearing(false)
    }
  }

  function resetScan() {
    abortRef.current = true
    for (const shot of shots) URL.revokeObjectURL(shot.url)
    setShots([])
    setCsvNames([])
    setRows([])
    setPlans({})
    setSelected(null)
    setExcludedList([])
    setTicker("")
    setSavedTicker(null)
    setRunStatus(null)
    setError(null)
    setScanId(newScanId())
    void clearQueue().then((result) => {
      setQueue({ path: queue?.path ?? "", fileName: null, scan: null, day: null, tickerCount: 0, tickers: [], updatedAt: null, rawCount: null, finalistCount: null })
      setNotice(
        result.archivedTo
          ? "Scan reset. Previous scan moved to Archive. Next save starts a new dated file."
          : "Scan reset. Queue cleared — next save starts a new dated file.",
      )
    }).catch((err: unknown) => {
      setNotice("Scan reset. Queue cleared.")
      setError(err instanceof Error ? err.message : String(err))
    })
    void clearSession()
  }

  function onSelectTicker(symbol: string) {
    if (running && !plans[symbol]) return
    if (running) pinnedRef.current = true
    setSelected(symbol)
  }

  function toggleExclude(symbol: string) {
    setExcludedList((currentList) => (
      currentList.includes(symbol) ? currentList.filter((item) => item !== symbol) : [...currentList, symbol]
    ))
  }

  function removeRow(symbol: string) {
    setRows((currentRows) => currentRows.filter((row) => row.ticker !== symbol))
    setPlans((currentPlans) => {
      if (!currentPlans[symbol]) return currentPlans
      const next = { ...currentPlans }
      delete next[symbol]
      return next
    })
    if (selected === symbol) setSelected(null)
  }

  function clearPending() {
    setRows((currentRows) => currentRows.filter((row) => row.status !== "queued" && row.status !== "failed" && row.status !== "skipped"))
  }

  const keeperIndex = Math.max(0, keepers.findIndex((plan) => plan.ticker === selected))

  return (
    <div className="screener">
      <Header
        tickerCount={queue?.tickerCount ?? 0}
        candidateCount={counts.candidate}
        developingCount={counts.developing}
        passCount={counts.pass}
        failCount={counts.failed}
        skipCount={counts.skipped}
        fileName={queue?.fileName}
        bookLabel={book?.label ?? (bookMode === "paper" ? "PAPER" : "LIVE")}
        bookEquity={book?.equity ?? null}
        placeCashOrders={book?.placeCashOrders ?? bookMode === "live"}
      />

      {error && <div className="banner">{error}</div>}
      {notice && <div className="banner ok">{notice}</div>}
      {missingPlans > 0 && !running && (
        <div className="banner ok">
          {missingPlans} graded names are missing their chart and plan. Click Run All to rebuild them — it only re-runs names that have no plan stored.
        </div>
      )}

      <ScreenshotDrop
        shots={shots}
        csvNames={csvNames}
        busy={reading || running}
        progress={ocrProgress}
        onAddFiles={(files) => void addFiles(files)}
        onRemove={removeShot}
      />

      <ScreenerTable
        rows={rows}
        plans={plans}
        selected={selected}
        followTicker={running ? scanTicker : null}
        busy={reading || running}
        onSelect={onSelectTicker}
        onRemove={removeRow}
        onClearPending={clearPending}
      />

      <form
        className="ticker-bar"
        onSubmit={(e) => {
          e.preventDefault()
          if (hasList) void runQueue()
          else void onAnalyze()
        }}
      >
        <input
          className="ticker-input"
          value={ticker}
          onChange={(e) => setTicker(e.target.value)}
          placeholder="TICKER or paste a list"
          spellCheck={false}
        />
        {!hasList && (
          <button className="btn primary" type="submit" disabled={loading || running}>
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        )}
        {hasList && (
          <button
            className="btn primary"
            type="submit"
            disabled={running || reading || remaining === 0}
          >
            {running ? "Running…" : "Run All"}
          </button>
        )}
        {running && runStatus && (
          <span className="tiny" aria-live="polite">{runStatus}</span>
        )}
        {running && (
          <button className="btn danger" type="button" onClick={() => { abortRef.current = true }}>
            Stop
          </button>
        )}
        <button className="btn" type="button" onClick={resetScan} disabled={running}>
          New scan
        </button>
        <button className="btn danger" type="button" onClick={() => setConfirmClear(true)}>
          Clear file
        </button>
      </form>

      {!running && keepers.length > 0 && (
        <SaveBatchBar
          keepers={keepers}
          excluded={excluded}
          saving={saving}
          onSave={() => void onSaveBatch()}
        />
      )}

      {!running && rows.length > 0 && remaining === 0 && keepers.length === 0 && (
        <div className="save-bar">
          <div>
            <div className="section-title" style={{ marginBottom: 6 }}>
              <h2>Nothing to save</h2>
            </div>
            <p className="tiny">
              This scan has no Candidate or Developing names. Pass never writes to the Desk list.
              Click Show on the screener, then a row, to open the chart and plan.
            </p>
          </div>
        </div>
      )}

      {!running && keepers.length > 0 && (
        <>
          <div className="review-nav">
            <button
              className="btn"
              type="button"
              disabled={keepers.length < 2}
              onClick={() => setSelected(keepers[(keeperIndex - 1 + keepers.length) % keepers.length].ticker)}
            >
              Prev
            </button>
            <span className="tiny">
              {keepers.length ? `${keeperIndex + 1} / ${keepers.length} keepers` : "No keepers"} · ← → to cycle · Pass stays in the table
            </span>
            <button
              className="btn"
              type="button"
              disabled={keepers.length < 2}
              onClick={() => setSelected(keepers[(keeperIndex + 1) % keepers.length].ticker)}
            >
              Next
            </button>
          </div>
          <ReviewStrip
            keepers={keepers}
            selected={selected}
            excluded={excluded}
            onSelect={setSelected}
          />
        </>
      )}

      {!current && !rows.length && (
        <div className="empty">
          <strong>Drop a TradingView CSV, then run the queue</strong>
          {connected
            ? "The table is the screener. Run All grades each name Candidate, Developing, or Pass. Save keepers to the Trade Desk list."
            : "Click Connect Robinhood once, then drop a screener CSV or click the drop zone to browse."}
        </div>
      )}

      {current && (
        <div className={`layout${excluded.has(current.ticker) ? " is-excluded" : ""}`}>
          <div className="panel">
            <div className="quote-row">
              <div>
                <div className="quote-id">
                  <div className="quote-ticker">{current.ticker}</div>
                  <GradeBadge grade={current.grade} size="lg" />
                </div>
                <div className="quote-name">{current.name}</div>
              </div>
              <div className="quote-px-wrap">
                <div className={`quote-px ${current.changePct >= 0 ? "is-up" : "is-down"}`}>
                  {money(current.lastPrice)}
                </div>
                <div className={`tiny ${current.changePct >= 0 ? "is-up" : "is-down"}`} style={{ textAlign: "right" }}>
                  {current.changePct >= 0 ? "+" : ""}{current.changePct.toFixed(2)}% · weekly {current.weeklyTrend}
                </div>
              </div>
            </div>
            <PriceChart plan={current} />
            <dl className="kpi-row">
              <div className="kpi"><dt>Entry</dt><dd>{px(current.entryPrice)}</dd></div>
              <div className="kpi"><dt>Stop</dt><dd>{px(current.stopPrice)}</dd></div>
              <div className="kpi"><dt>R1</dt><dd>{px(current.r1)}</dd></div>
              <div className="kpi"><dt>To level</dt><dd>{gapShort(current)}</dd></div>
            </dl>
          </div>
          <PlanPanel
            plan={current}
            saving={saving}
            saved={savedTicker === current.ticker}
            excluded={excluded.has(current.ticker)}
            onSave={() => void onSave()}
            onToggleExclude={keepers.some((item) => item.ticker === current.ticker) ? () => toggleExclude(current.ticker) : undefined}
          />
        </div>
      )}

      {confirmClear && (
        <ConfirmModal
          title="Clear today's list?"
          body="This moves the current scan into desk-data/scans/Archive. That folder keeps only one live scan. It cannot be undone from this screen."
          confirmLabel="Archive and clear"
          busy={clearing}
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => void onClear()}
        />
      )}
    </div>
  )
}
