import fs from "node:fs"
import type { BookMode } from "../src/types"
import {
  ACCOUNT_FILE,
  LAST_REFRESH_FILE,
  ensureDeskDirs,
} from "./deskPaths"
import { nowPtStamp } from "./http"

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

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n)
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

/** Live Robinhood cash book. Paper is gone. */
export function readActiveAccount(): AccountSnapshot {
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

export function sessionLabel(_mode?: BookMode) {
  return "LIVE" as const
}
