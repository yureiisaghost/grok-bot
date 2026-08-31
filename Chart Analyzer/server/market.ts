import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { OhlcvBar } from "../src/types"
import { normalizeTicker } from "./http"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BRIDGE_DIR = path.resolve(__dirname, "..", ".bridge")
const CACHE_DIR = path.join(BRIDGE_DIR, "cache")
const INBOX_FILE = path.join(BRIDGE_DIR, "inbox.json")

export interface MarketPack {
  ticker: string
  name: string
  quote: {
    last: number
    previousClose: number
    bid: number | null
    ask: number | null
    sessionDate?: string | null
    officialClose?: number | null
    officialCloseDate?: string | null
  }
  fundamentals: {
    high52: number | null
    low52: number | null
    marketCap: number | null
    float: number | null
    avgVolume: number | null
    avgVolume2Weeks: number | null
    pe: number | null
    sector: string | null
    industry: string | null
    description: string | null
  }
  instrument?: {
    type: string | null
    tradeable: boolean | null
  }
  spyCloses?: number[]
  daily: OhlcvBar[]
  weekly: OhlcvBar[]
  earningsDate: string | null
  equity: number | null
  source?: string
  fetchedAt?: string
}

export class DataError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = "data") {
    super(message)
    this.status = status
    this.code = code
  }
}

function ensureDirs() {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
}

function cachePath(ticker: string) {
  return path.join(CACHE_DIR, `${ticker}.json`)
}

export function requestTicker(raw: string) {
  const ticker = normalizeTicker(raw)
  if (!ticker) throw new DataError("Enter a ticker.", 400, "validate")
  return ticker
}

export function pendingTicker() {
  try {
    if (!fs.existsSync(INBOX_FILE)) return null
    const data = JSON.parse(fs.readFileSync(INBOX_FILE, "utf8")) as { ticker?: string }
    return data.ticker ? normalizeTicker(data.ticker) : null
  } catch {
    return null
  }
}

export function readPack(ticker: string): MarketPack | null {
  const file = cachePath(normalizeTicker(ticker))
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as MarketPack
  } catch {
    return null
  }
}

export function writePack(pack: MarketPack) {
  ensureDirs()
  const ticker = normalizeTicker(pack.ticker)
  const next: MarketPack = { ...pack, ticker, fetchedAt: pack.fetchedAt || new Date().toISOString() }
  fs.writeFileSync(cachePath(ticker), JSON.stringify(next, null, 2), "utf8")
  return next
}

export function requirePack(ticker: string): MarketPack {
  const pack = readPack(ticker)
  if (!pack || !pack.daily?.length) {
    throw new DataError(
      `No Robinhood MCP snapshot for ${ticker} yet. In this Cursor chat, ask me to pull ${ticker} from the official Trading MCP, then press Enter again.`,
      409,
      "needs_mcp",
    )
  }
  return pack
}
