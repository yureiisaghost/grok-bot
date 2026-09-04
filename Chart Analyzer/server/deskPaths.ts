import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const ROOT = path.resolve(__dirname, "..", "..")
export const DESK_DIR = path.join(ROOT, "desk-data")
export const SCANS_DIR = path.join(DESK_DIR, "scans")
export const ARCHIVE_DIR = path.join(SCANS_DIR, "Archive")
export const OUTCOMES_DIR = path.join(SCANS_DIR, "outcomes")
export const ACTIVE_FILE = path.join(SCANS_DIR, ".active-scan.json")
export const LAST_REFRESH_FILE = path.join(DESK_DIR, "last-refresh.json")
export const SETTINGS_FILE = path.join(DESK_DIR, "settings.json")
export const ACCOUNT_FILE = path.join(DESK_DIR, "account.json")
export const REGIME_FILE = path.join(DESK_DIR, "regime.json")
export const WATCHES_FILE = path.join(DESK_DIR, "watches.json")
export const MACRO_OVERRIDE_FILE = path.join(DESK_DIR, "macro-calendar.json")
export const SCAN_PROGRESS_FILE = path.join(SCANS_DIR, ".scan-progress.json")
/** Yurei drops the TradingView screener CSV here. Bot does not download TradingView. */
export const SCREENER_UPLOADS_DIR = path.join(ROOT, "Screener Uploads")
export const SCREENER_ARCHIVE_DIR = path.join(SCREENER_UPLOADS_DIR, "Archive")
export const ROBINHOOD_DIR = path.join(ROOT, "Robinhood")
/** Queued / pending cash tickets after Yurei says take. Not the Bot scan pack. */
export const TICKETS_DIR = path.join(ROBINHOOD_DIR, "Tickets")
export const FILLED_DIR = path.join(ROBINHOOD_DIR, "Filled")
export const STALE_DIR = path.join(ROBINHOOD_DIR, "Stale")
export const HANDOFF_DIR = path.join(ROOT, "handoff")
export const HANDOFF_MANIFEST_FILE = path.join(HANDOFF_DIR, "GROK-HANDOFF.json")
export const HANDOFF_BRIEF_FILE = path.join(HANDOFF_DIR, "DESK-BRIEF.md")
export const ACTIVE_SESSION_JSON = path.join(HANDOFF_DIR, "ACTIVE-SESSION.json")
export const ACTIVE_SESSION_MD = path.join(HANDOFF_DIR, "ACTIVE-SESSION.md")

export type QueueDirs = {
  potential: string
  filled: string
  drivePotential: string
  driveFilled: string
}

export function snapshotFile() {
  return LAST_REFRESH_FILE
}

export function queueDirs(): QueueDirs {
  return {
    potential: TICKETS_DIR,
    filled: FILLED_DIR,
    drivePotential: "Robinhood/Tickets",
    driveFilled: "Robinhood/Filled",
  }
}

export function posixRel(abs: string) {
  return path.relative(ROOT, abs).split(path.sep).join("/")
}

export function ensureDeskDirs() {
  fs.mkdirSync(SCANS_DIR, { recursive: true })
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true })
  fs.mkdirSync(OUTCOMES_DIR, { recursive: true })
  fs.mkdirSync(HANDOFF_DIR, { recursive: true })
  fs.mkdirSync(SCREENER_UPLOADS_DIR, { recursive: true })
  fs.mkdirSync(SCREENER_ARCHIVE_DIR, { recursive: true })
}

export function ensureRobinhoodDirs() {
  fs.mkdirSync(TICKETS_DIR, { recursive: true })
  fs.mkdirSync(FILLED_DIR, { recursive: true })
  fs.mkdirSync(STALE_DIR, { recursive: true })
}

export function ensureHandoffDir() {
  fs.mkdirSync(HANDOFF_DIR, { recursive: true })
}
