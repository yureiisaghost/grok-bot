import fs from "node:fs"
import { ACCOUNT_FILE } from "./deskPaths"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

export interface AccountSnapshot {
  equity: number | null
  remainingRoom: number | null
  riskPct: number | null
}

function money(raw: string) {
  const n = Number(raw.replace(/[$,]/g, ""))
  return Number.isFinite(n) ? n : null
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = obj[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string") {
      const n = money(value)
      if (n != null) return n
    }
  }
  return null
}

function parseJson(file: string): AccountSnapshot | null {
  const data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
  if (!data || typeof data !== "object") return null
  return {
    equity: pick(data, ["equity", "Equity"]),
    remainingRoom: pick(data, ["remaining_room", "remainingRoom", "room"]),
    riskPct: pick(data, ["risk_pct", "riskPct", "risk"]),
  }
}

function parseMd(file: string): AccountSnapshot | null {
  const text = fs.readFileSync(file, "utf8")
  const grab = (label: string) => {
    const re = new RegExp(`${label}[^\\d$]*(\\$?[0-9][0-9,]*(?:\\.[0-9]+)?)`, "i")
    const m = text.match(re)
    return m ? money(m[1]) : null
  }
  return {
    equity: grab("equity"),
    remainingRoom: grab("remaining[_ ]room") ?? grab("room"),
    riskPct: grab("risk[_ ]pct") ?? grab("risk %"),
  }
}

/** Read-only. Missing or unreadable file → null. Never throws. */
export function readAccountSnapshot(): AccountSnapshot | null {
  try {
    if (fs.existsSync(ACCOUNT_FILE)) return parseJson(ACCOUNT_FILE)
    const json = path.join(ROOT, "Grok Bot", "Account.json")
    if (fs.existsSync(json)) return parseJson(json)
    const md = path.join(ROOT, "Grok Bot", "Account.md")
    if (fs.existsSync(md)) return parseMd(md)
    return null
  } catch {
    return null
  }
}

export function sizeFromRoom(
  remainingRoom: number | null | undefined,
  entry: number | null | undefined,
  stop: number | null | undefined,
) {
  if (remainingRoom == null || !Number.isFinite(remainingRoom) || remainingRoom <= 0) return null
  if (entry == null || stop == null || !Number.isFinite(entry) || !Number.isFinite(stop) || entry <= stop) return null
  const shares = Math.floor(remainingRoom / (entry - stop))
  return {
    plannedSharesAtRoom: shares,
    sizeableNow: shares >= 1,
    plannedNotional: shares >= 1 ? shares * entry : 0,
  }
}
