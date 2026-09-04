import fs from "node:fs"
import type { DeskPick, DeskSettings, DeskSnapshot, DeskState, OhlcvBar, PlanOfAttack } from "../src/types"
import { nowPtStamp, todayPtIso } from "./http"
import { loadDeskUniverse } from "./markdown"
import { SETTINGS_FILE, ensureDeskDirs, snapshotFile } from "./deskPaths"
import { writeAccountFromActive, writeAccountSummary } from "./accountSnapshot"
import { writeHandoff } from "./handoff"
import { clampSettings, DEFAULT_SETTINGS, pickForBook, type AccountBook } from "./picker"
import { fetchAccountBook, fetchDeskDaily, fetchDeskEarnings, fetchDeskQuotes, fetchDeskTape } from "./rhMcp"
import { evaluateRegime } from "./regime"
import { applyQuotesToPositions, overlayPlanQuote, quotePriority } from "./liveOverlay"
import { applyMacroBlackout, loadMacroEvents } from "./macro"
import { annotateHeldPositions } from "./heldState"
import { buildHeldChartPlan } from "./heldChart"
import { syncPotentialPackets } from "./potentialQueue"

export function readDeskSettings(): DeskSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
    return clampSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<DeskSettings>)
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeDeskSettings(raw: Partial<DeskSettings>): DeskSettings {
  ensureDeskDirs()
  const settings = clampSettings({ ...readDeskSettings(), ...raw })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8")
  const snapshot = readLastSnapshot()
  if (snapshot) writeLiveAccount(snapshot)
  else writeAccountFromActive()
  writeHandoff("settings")
  return settings
}

function readLastSnapshot(): DeskSnapshot | null {
  try {
    const file = snapshotFile()
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, "utf8")) as DeskSnapshot
  } catch {
    return null
  }
}

function writeLastSnapshot(snapshot: DeskSnapshot) {
  ensureDeskDirs()
  fs.writeFileSync(snapshotFile(), JSON.stringify(snapshot, null, 2), "utf8")
}

function writeLiveAccount(snapshot: DeskSnapshot) {
  writeAccountSummary({
    bookMode: "live",
    placeCashOrders: true,
    equity: snapshot.book.equity,
    cash: snapshot.book.cash,
    remainingRoom: snapshot.book.remainingHeat,
    riskPct: snapshot.book.perNameRisk,
    maxHeat: snapshot.book.maxHeat,
    updatedAt: snapshot.refreshedAt,
  })
}

export function readDeskState(): DeskState {
  return {
    settings: readDeskSettings(),
    snapshot: readLastSnapshot(),
  }
}

/** After Place Order, keep the on-disk snapshot in sync so heat/cards update without a full Refresh. */
export function noteWorkingPick(pick: DeskPick, status: "queued" | "pending") {
  const snapshot = readLastSnapshot()
  if (!snapshot) return
  const ticker = pick.ticker.toUpperCase()
  const working = [
    ...(snapshot.working ?? []).filter((row) => row.ticker.toUpperCase() !== ticker),
    { ...pick, ticker, orderStatus: status },
  ]
  const pendingHeat = working.reduce((sum, row) => sum + (Number.isFinite(row.dollarRisk) ? row.dollarRisk : 0), 0)
  const next: DeskSnapshot = {
    ...snapshot,
    working,
    pick: snapshot.pick?.ticker.toUpperCase() === ticker ? { ...snapshot.pick, orderStatus: status } : snapshot.pick,
    runnerUp: snapshot.runnerUp?.ticker.toUpperCase() === ticker ? { ...snapshot.runnerUp, orderStatus: status } : snapshot.runnerUp,
    book: {
      ...snapshot.book,
      pendingHeat,
      remainingHeat: Math.max(0, snapshot.book.maxHeat - snapshot.book.openHeat - pendingHeat),
    },
  }
  writeLastSnapshot(next)
  writeLiveAccount(next)
}

function extraClosesFrom(
  extraBars: Map<string, OhlcvBar[]>,
): Record<string, number[]> {
  const heldCloses: Record<string, number[]> = {}
  for (const [ticker, bars] of extraBars) heldCloses[ticker] = bars.map((bar) => bar.close)
  return heldCloses
}

async function loadBook(): Promise<AccountBook> {
  return fetchAccountBook()
}

export async function refreshDesk(): Promise<DeskState> {
  const settings = readDeskSettings()
  const previous = readLastSnapshot()
  const universe = loadDeskUniverse()
  const today = todayPtIso()
  const [book, tape] = await Promise.all([
    loadBook(),
    fetchDeskTape().catch((err) => {
      console.warn(`[desk] tape pull failed (${err instanceof Error ? err.message : String(err)}). Regime unknown.`)
      return { qqqDaily: [], spyWeekly: [] }
    }),
  ])
  const pendingTickers = (book.openBuys ?? []).map((row) => ({ ticker: row.ticker }))
  const symbols = quotePriority(universe.plans, [...book.positions, ...pendingTickers])
  const heldNeedDaily = book.positions
    .map((pos) => pos.ticker)
    .filter((ticker) => {
      const plan = universe.plans.find((row) => row.ticker.toUpperCase() === ticker.toUpperCase())
      return (plan?.chart?.length ?? 0) < 50
    })
  const heldTickers = book.positions.map((pos) => pos.ticker)
  const [quotes, extraDaily, extraEarn] = await Promise.all([
    fetchDeskQuotes(symbols).catch((err) => {
      console.warn(`[desk] quotes failed (${err instanceof Error ? err.message : String(err)}). Using saved last.`)
      return new Map<string, { last: number; previousClose: number | null }>()
    }),
    fetchDeskDaily(heldNeedDaily).catch((err) => {
      console.warn(`[desk] held daily failed (${err instanceof Error ? err.message : String(err)}).`)
      return new Map<string, OhlcvBar[]>()
    }),
    fetchDeskEarnings(heldTickers).catch((err) => {
      console.warn(`[desk] held earnings failed (${err instanceof Error ? err.message : String(err)}).`)
      return new Map<string, string>()
    }),
  ])
  const plans = universe.plans.map((plan) => {
    const quote = quotes.get(plan.ticker.toUpperCase())
    return quote ? overlayPlanQuote(plan, quote) : plan
  })
  const workingBook = book
  const marked = applyQuotesToPositions(workingBook.positions, quotes)
  const queued = syncPotentialPackets(marked, workingBook.openBuys === undefined ? [] : workingBook.openBuys, "live")
  const working = queued.working.map((row) => {
    const quote = quotes.get(row.ticker.toUpperCase())
    return quote ? { ...row, lastPrice: quote.last } : row
  })
  const regime = applyMacroBlackout(evaluateRegime(tape.qqqDaily, tape.spyWeekly, today), today, loadMacroEvents())
  const usedNewList = Boolean(
    universe.meta.signature
    && universe.meta.signature !== previous?.scan?.signature,
  )
  const extraBars: Record<string, OhlcvBar[]> = {}
  for (const [ticker, bars] of extraDaily) extraBars[ticker] = bars
  const earnDates: Record<string, string> = {}
  for (const [ticker, date] of extraEarn) earnDates[ticker] = date
  const snapshot = pickForBook(plans, { ...workingBook, positions: marked }, settings, {
    usedNewList,
    scan: universe.meta.fileName || universe.plans.length ? universe.meta : null,
    refreshedAt: nowPtStamp(),
    regime,
    heldCloses: extraClosesFrom(extraDaily),
    working,
    bookMode: "live",
  })
  snapshot.working = working
  snapshot.filledFromQueue = queued.filledTickers
  snapshot.positions = annotateHeldPositions(snapshot.positions, {
    plans,
    extraBars,
    extraEarn: earnDates,
    regime,
    today,
  })
  snapshot.heldCharts = extraBars
  writeLastSnapshot(snapshot)
  writeLiveAccount(snapshot)
  writeHandoff("refresh")
  return { settings, snapshot }
}

/** Saved keeper plan for a ticket click. Overlays the live last from the last Refresh. Does not re-run detectors. */
export function readDeskPlan(ticker: string): PlanOfAttack | null {
  const symbol = ticker.trim().toUpperCase()
  if (!symbol) return null
  const plan = loadDeskUniverse().plans.find((row) => row.ticker.toUpperCase() === symbol)
  if (!plan) return null
  const snapshot = readLastSnapshot()
  const fromPick = snapshot?.pick?.ticker.toUpperCase() === symbol ? snapshot.pick
    : snapshot?.runnerUp?.ticker.toUpperCase() === symbol ? snapshot.runnerUp
    : null
  const fromPos = snapshot?.positions.find((pos) => pos.ticker.toUpperCase() === symbol)
  const last = fromPick?.lastPrice ?? fromPos?.lastPrice ?? plan.lastPrice
  if (last != null && last > 0 && last !== plan.lastPrice) {
    return overlayPlanQuote(plan, { last, previousClose: plan.previousClose })
  }
  return plan
}

/** Keeper plan if saved; otherwise a chart-only held plan from daily bars. Does not re-run detectors. */
export async function loadDeskPlan(ticker: string): Promise<PlanOfAttack | null> {
  const symbol = ticker.trim().toUpperCase()
  if (!symbol) return null
  const saved = readDeskPlan(symbol)
  if (saved) return saved
  const snapshot = readLastSnapshot()
  const pos = snapshot?.positions.find((row) => row.ticker.toUpperCase() === symbol)
  if (!snapshot || !pos) return null
  const cached = snapshot.heldCharts?.[symbol] ?? snapshot.heldCharts?.[pos.ticker]
  if (cached?.length) return buildHeldChartPlan(pos, cached)
  try {
    const daily = await fetchDeskDaily([symbol])
    const bars = daily.get(symbol) ?? []
    if (bars.length) {
      if (snapshot.heldCharts) snapshot.heldCharts[symbol] = bars
      else snapshot.heldCharts = { [symbol]: bars }
      writeLastSnapshot(snapshot)
    }
    return buildHeldChartPlan(pos, bars)
  } catch {
    return buildHeldChartPlan(pos, [])
  }
}
