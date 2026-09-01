import fs from "node:fs"
import type { DeskPick, PotentialOrderRole } from "../src/types"
import { PAPER_ACCOUNT_FILE, ensureDeskDirs } from "./deskPaths"
import { nowPtStamp } from "./http"
import type { LiveQuote } from "./liveOverlay"
import type { OpenBuyOrder } from "./orders"
import type { AccountBook, BookPosition } from "./picker"

export interface PaperPendingBuy {
  ticker: string
  shares: number
  entryPrice: number
  limitCeiling: number | null
  stopPrice: number
  dollarRisk: number
  notional: number
  queuedAt: string
  role: PotentialOrderRole
}

export interface PaperClosedTrade {
  ticker: string
  shares: number
  avgCost: number
  exitPrice: number
  pnl: number
  reason: "stop"
  closedAt: string
}

export interface PaperAccount {
  schema: "paper-account/v1"
  bookMode: "paper"
  startingCash: number
  cash: number
  equity: number
  positions: BookPosition[]
  pendingBuys: PaperPendingBuy[]
  closed: PaperClosedTrade[]
  equityHistory: Array<{ at: string; equity: number; cash: number }>
  updatedAt: string
}

const HISTORY_CAP = 120

function money(n: number) {
  return Number.isFinite(n) ? n : 0
}

function markPositions(positions: BookPosition[], quotes: Map<string, LiveQuote>): BookPosition[] {
  return positions.map((pos) => {
    const last = quotes.get(pos.ticker.toUpperCase())?.last
    if (!(last != null && last > 0)) return pos
    return { ...pos, lastPrice: last, marketValue: last * pos.quantity }
  })
}

function markEquity(ledger: PaperAccount): PaperAccount {
  const market = ledger.positions.reduce((sum, pos) => {
    const last = pos.lastPrice ?? pos.avgCost ?? 0
    return sum + pos.quantity * last
  }, 0)
  return { ...ledger, equity: money(ledger.cash) + market }
}

export function emptyPaperAccount(startingCash: number, stamp = nowPtStamp()): PaperAccount {
  const cash = Math.max(0, money(startingCash))
  return {
    schema: "paper-account/v1",
    bookMode: "paper",
    startingCash: cash,
    cash,
    equity: cash,
    positions: [],
    pendingBuys: [],
    closed: [],
    equityHistory: [{ at: stamp, equity: cash, cash }],
    updatedAt: stamp,
  }
}

export function readPaperAccount(startingCash = 5000): PaperAccount {
  try {
    if (!fs.existsSync(PAPER_ACCOUNT_FILE)) return emptyPaperAccount(startingCash)
    const raw = JSON.parse(fs.readFileSync(PAPER_ACCOUNT_FILE, "utf8")) as Partial<PaperAccount>
    const seed = emptyPaperAccount(money(raw.startingCash ?? 0) || startingCash)
    return {
      ...seed,
      ...raw,
      schema: "paper-account/v1",
      bookMode: "paper",
      positions: Array.isArray(raw.positions) ? raw.positions : [],
      pendingBuys: Array.isArray(raw.pendingBuys) ? raw.pendingBuys : [],
      closed: Array.isArray(raw.closed) ? raw.closed : [],
      equityHistory: Array.isArray(raw.equityHistory) ? raw.equityHistory : seed.equityHistory,
    }
  } catch {
    return emptyPaperAccount(startingCash)
  }
}

export function writePaperAccount(ledger: PaperAccount) {
  ensureDeskDirs()
  fs.writeFileSync(PAPER_ACCOUNT_FILE, JSON.stringify(markEquity(ledger), null, 2), "utf8")
}

export function paperToBook(ledger: PaperAccount): AccountBook {
  const marked = markEquity(ledger)
  return {
    accountNumber: "PAPER",
    equity: marked.equity,
    cash: marked.cash,
    buyingPower: marked.cash,
    positions: marked.positions,
    openBuys: marked.pendingBuys.map(pendingToBuy),
  }
}

function pendingToBuy(row: PaperPendingBuy): OpenBuyOrder {
  return {
    ticker: row.ticker.toUpperCase(),
    state: "confirmed",
    quantity: row.shares,
    filledQuantity: 0,
    type: "limit",
    trigger: "stop",
    stopPrice: row.entryPrice,
    limitPrice: row.limitCeiling,
  }
}

export function addPaperPending(pick: DeskPick, role: PotentialOrderRole, queuedAt: string): PaperAccount {
  const ledger = readPaperAccount()
  const ticker = pick.ticker.toUpperCase()
  if (ledger.positions.some((pos) => pos.ticker.toUpperCase() === ticker && pos.quantity > 0)) return ledger
  const pending: PaperPendingBuy = {
    ticker,
    shares: pick.shares,
    entryPrice: pick.entryPrice,
    limitCeiling: pick.limitCeiling,
    stopPrice: pick.stopPrice,
    dollarRisk: pick.dollarRisk,
    notional: pick.notional,
    queuedAt,
    role,
  }
  const next = {
    ...ledger,
    pendingBuys: [...ledger.pendingBuys.filter((row) => row.ticker.toUpperCase() !== ticker), pending],
    updatedAt: queuedAt,
  }
  writePaperAccount(next)
  return next
}

export function applyPaperTape(
  ledger: PaperAccount,
  quotes: Map<string, LiveQuote>,
  stamp: string,
): { ledger: PaperAccount; filledTickers: string[]; stoppedTickers: string[] } {
  const filledTickers: string[] = []
  const stoppedTickers: string[] = []
  let cash = money(ledger.cash)
  let positions = markPositions(ledger.positions, quotes)
  const stillPending: PaperPendingBuy[] = []

  for (const pending of ledger.pendingBuys) {
    const last = quotes.get(pending.ticker.toUpperCase())?.last
    if (!(last != null && last > 0) || last < pending.entryPrice) {
      stillPending.push(pending)
      continue
    }
    const fillPrice = pending.limitCeiling != null && pending.limitCeiling > 0
      ? Math.min(last, pending.limitCeiling)
      : last
    const cost = pending.shares * fillPrice
    if (!(fillPrice > 0) || cash + 1e-9 < cost) {
      stillPending.push(pending)
      continue
    }
    cash -= cost
    positions = positions.filter((pos) => pos.ticker.toUpperCase() !== pending.ticker.toUpperCase())
    positions.push({
      ticker: pending.ticker.toUpperCase(),
      quantity: pending.shares,
      avgCost: fillPrice,
      lastPrice: last,
      marketValue: last * pending.shares,
      stopPrice: pending.stopPrice,
    })
    filledTickers.push(pending.ticker.toUpperCase())
  }

  const kept: BookPosition[] = []
  const closed = [...ledger.closed]
  for (const pos of positions) {
    const last = pos.lastPrice
    const stop = pos.stopPrice
    if (last != null && stop != null && last > 0 && last <= stop && pos.quantity > 0) {
      const proceeds = pos.quantity * last
      const avg = pos.avgCost ?? last
      cash += proceeds
      closed.push({
        ticker: pos.ticker.toUpperCase(),
        shares: pos.quantity,
        avgCost: avg,
        exitPrice: last,
        pnl: (last - avg) * pos.quantity,
        reason: "stop",
        closedAt: stamp,
      })
      stoppedTickers.push(pos.ticker.toUpperCase())
      continue
    }
    kept.push(pos)
  }

  let next: PaperAccount = markEquity({
    ...ledger,
    cash,
    positions: kept,
    pendingBuys: stillPending,
    closed,
    updatedAt: stamp,
  })
  const history = [...(next.equityHistory ?? []), { at: stamp, equity: next.equity, cash: next.cash }]
  next = { ...next, equityHistory: history.slice(-HISTORY_CAP) }
  return { ledger: next, filledTickers, stoppedTickers }
}
