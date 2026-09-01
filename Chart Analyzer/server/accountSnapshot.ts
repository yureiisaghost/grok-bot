import fs from "node:fs"
import type { BookMode } from "../src/types"
import {
  ACCOUNT_FILE,
  LAST_REFRESH_FILE,
  SETTINGS_FILE,
  ensureDeskDirs,
} from "./deskPaths"
import { nowPtStamp } from "./http"
import { readPaperAccount } from "./paperAccount"

export interface AccountSnapshot {
  bookMode: BookMode
  equity: number | null
  cash: number | null
  remainingRoom: number | null
  riskPct: number | null
  maxHeat: number | null
  placeCashOrders: boolean
  updatedAt?: string
}

type LooseSettings = {
  bookMode: BookMode
  riskPct: number
  maxHeatPct: number
  paperStartingCash: number
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

function readSettingsLoose(): LooseSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) {
      return { bookMode: "live", riskPct: 1, maxHeatPct: 6, paperStartingCash: 5000 }
    }
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Record<string, unknown>
    return {
      bookMode: raw.bookMode === "paper" ? "paper" : "live",
      riskPct: finite(raw.riskPct) ? raw.riskPct : 1,
      maxHeatPct: finite(raw.maxHeatPct) ? raw.maxHeatPct : 6,
      paperStartingCash: finite(raw.paperStartingCash) ? raw.paperStartingCash : 5000,
    }
  } catch {
    return { bookMode: "live", riskPct: 1, maxHeatPct: 6, paperStartingCash: 5000 }
  }
}

function fromDeskSnapshot(file: string, mode: BookMode): AccountSnapshot | null {
  try {
    if (!fs.existsSync(file)) return null
    const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
      refreshedAt?: string
      book?: {
        equity?: number
        cash?: number
        remainingHeat?: number
        perNameRisk?: number
        maxHeat?: number
      }
    }
    const book = data.book
    if (!book || !finite(book.equity)) return null
    return {
      bookMode: mode,
      equity: book.equity,
      cash: finite(book.cash) ? book.cash : book.equity,
      remainingRoom: finite(book.remainingHeat) ? book.remainingHeat : null,
      riskPct: finite(book.perNameRisk) ? book.perNameRisk : book.equity * 0.01,
      maxHeat: finite(book.maxHeat) ? book.maxHeat : book.equity * 0.06,
      placeCashOrders: mode === "live",
      updatedAt: data.refreshedAt,
    }
  } catch {
    return null
  }
}

function fromPaperLedger(settings: LooseSettings): AccountSnapshot {
  const ledger = readPaperAccount(settings.paperStartingCash)
  const equity = Math.max(0, ledger.equity)
  const cash = Math.max(0, ledger.cash)
  const maxHeat = equity * (settings.maxHeatPct / 100)
  const perName = equity * (settings.riskPct / 100)
  const openHeat = ledger.positions.reduce((sum, pos) => {
    const last = pos.lastPrice ?? pos.avgCost
    const stop = pos.stopPrice
    if (!(pos.quantity > 0) || last == null || stop == null) return sum
    return sum + pos.quantity * Math.max(0, last - stop)
  }, 0)
  const pendingHeat = ledger.pendingBuys.reduce((sum, row) => sum + (finite(row.dollarRisk) ? row.dollarRisk : 0), 0)
  return {
    bookMode: "paper",
    equity,
    cash,
    remainingRoom: Math.max(0, maxHeat - openHeat - pendingHeat),
    riskPct: perName,
    maxHeat,
    placeCashOrders: false,
    updatedAt: ledger.updatedAt,
  }
}

/** Active Live or Paper book the screener and Phone Grok should size against. */
export function readActiveAccount(): AccountSnapshot {
  const settings = readSettingsLoose()
  if (settings.bookMode === "paper") return fromPaperLedger(settings)
  return fromDeskSnapshot(LAST_REFRESH_FILE, "live") ?? {
    bookMode: "live",
    equity: null,
    cash: null,
    remainingRoom: null,
    riskPct: null,
    maxHeat: null,
    placeCashOrders: true,
  }
}

/** @deprecated use readActiveAccount — kept so older callers still compile. */
export function readAccountSnapshot(): AccountSnapshot | null {
  const active = readActiveAccount()
  if (active.equity == null && active.remainingRoom == null) return null
  return active
}

export function writeAccountSummary(row: AccountSnapshot) {
  ensureDeskDirs()
  fs.writeFileSync(ACCOUNT_FILE, JSON.stringify({
    bookMode: row.bookMode,
    placeCashOrders: row.placeCashOrders,
    equity: row.equity,
    cash: row.cash,
    remaining_room: row.remainingRoom,
    risk_pct: row.riskPct,
    max_heat: row.maxHeat,
    updatedAt: row.updatedAt ?? nowPtStamp(),
  }, null, 2), "utf8")
}

export function writeAccountFromActive() {
  writeAccountSummary(readActiveAccount())
}

export function sizeFromAccount(
  account: AccountSnapshot | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
) {
  if (!account) return null
  if (entry == null || stop == null || !Number.isFinite(entry) || !Number.isFinite(stop) || entry <= stop) return null
  const risk = entry - stop
  const known = account.remainingRoom != null || account.riskPct != null || account.cash != null
  if (!known) return null
  let shares = Number.POSITIVE_INFINITY
  if (account.remainingRoom != null && Number.isFinite(account.remainingRoom)) {
    shares = Math.min(shares, account.remainingRoom <= 0 ? 0 : Math.floor(account.remainingRoom / risk))
  }
  if (account.riskPct != null && Number.isFinite(account.riskPct)) {
    shares = Math.min(shares, account.riskPct <= 0 ? 0 : Math.floor(account.riskPct / risk))
  }
  if (account.cash != null && Number.isFinite(account.cash)) {
    shares = Math.min(shares, account.cash <= 0 ? 0 : Math.floor(account.cash / entry))
  }
  if (!Number.isFinite(shares)) return null
  const qty = Math.max(0, shares)
  return {
    plannedSharesAtRoom: qty,
    sizeableNow: qty >= 1,
    plannedNotional: qty >= 1 ? qty * entry : 0,
  }
}

export function sizeFromRoom(
  remainingRoom: number | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
) {
  return sizeFromAccount(
    remainingRoom == null ? null : {
      bookMode: "live",
      equity: null,
      cash: null,
      remainingRoom,
      riskPct: remainingRoom,
      maxHeat: remainingRoom,
      placeCashOrders: true,
    },
    entry,
    stop,
  )
}

export function sessionLabel(mode: BookMode | undefined) {
  return mode === "paper" ? "PAPER" : "LIVE"
}
