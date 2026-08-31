import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, "..", "..")
export const DESK_DIR = path.join(ROOT, "desk-data")
export const SCANS_DIR = path.join(DESK_DIR, "scans")
export const ARCHIVE_DIR = path.join(SCANS_DIR, "Archive")
export const ACTIVE_FILE = path.join(SCANS_DIR, ".active-scan.json")
export const LAST_REFRESH_FILE = path.join(DESK_DIR, "last-refresh.json")
export const SETTINGS_FILE = path.join(DESK_DIR, "settings.json")
export const ACCOUNT_FILE = path.join(DESK_DIR, "account.json")
export const MACRO_OVERRIDE_FILE = path.join(DESK_DIR, "macro-calendar.json")
export const ROBINHOOD_DIR = path.join(ROOT, "Robinhood")
export const POTENTIAL_TICKERS_DIR = path.join(ROBINHOOD_DIR, "Potential Tickers")
export const FILLED_TICKERS_DIR = path.join(ROBINHOOD_DIR, "Filled Tickers")

export function ensureDeskDirs() {
  fs.mkdirSync(SCANS_DIR, { recursive: true })
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
}

export function ensureRobinhoodDirs() {
  fs.mkdirSync(POTENTIAL_TICKERS_DIR, { recursive: true })
  fs.mkdirSync(FILLED_TICKERS_DIR, { recursive: true })
}
