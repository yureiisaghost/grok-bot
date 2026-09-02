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
export const LAST_REFRESH_PAPER_FILE = path.join(DESK_DIR, "last-refresh-paper.json")
export const SETTINGS_FILE = path.join(DESK_DIR, "settings.json")
export const ACCOUNT_FILE = path.join(DESK_DIR, "account.json")
export const PAPER_ACCOUNT_FILE = path.join(DESK_DIR, "paper-account.json")
export const MACRO_OVERRIDE_FILE = path.join(DESK_DIR, "macro-calendar.json")
export const ROBINHOOD_DIR = path.join(ROOT, "Robinhood")
export const POTENTIAL_TICKERS_DIR = path.join(ROBINHOOD_DIR, "Potential Tickers")
export const FILLED_TICKERS_DIR = path.join(ROBINHOOD_DIR, "Filled Tickers")
export const PAPER_ROBINHOOD_DIR = path.join(ROBINHOOD_DIR, "Paper")
export const PAPER_POTENTIAL_DIR = path.join(PAPER_ROBINHOOD_DIR, "Potential Tickers")
export const PAPER_FILLED_DIR = path.join(PAPER_ROBINHOOD_DIR, "Filled Tickers")
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

export function snapshotFile(mode: "live" | "paper") {
  return mode === "paper" ? LAST_REFRESH_PAPER_FILE : LAST_REFRESH_FILE
}

export function queueDirs(mode: "live" | "paper"): QueueDirs {
  if (mode === "paper") {
    return {
      potential: PAPER_POTENTIAL_DIR,
      filled: PAPER_FILLED_DIR,
      drivePotential: "Robinhood/Paper/Potential Tickers",
      driveFilled: "Robinhood/Paper/Filled Tickers",
    }
  }
  return {
    potential: POTENTIAL_TICKERS_DIR,
    filled: FILLED_TICKERS_DIR,
    drivePotential: "Robinhood/Potential Tickers",
    driveFilled: "Robinhood/Filled Tickers",
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
}

export function ensureRobinhoodDirs() {
  fs.mkdirSync(POTENTIAL_TICKERS_DIR, { recursive: true })
  fs.mkdirSync(FILLED_TICKERS_DIR, { recursive: true })
  fs.mkdirSync(PAPER_POTENTIAL_DIR, { recursive: true })
  fs.mkdirSync(PAPER_FILLED_DIR, { recursive: true })
}

export function ensureHandoffDir() {
  fs.mkdirSync(HANDOFF_DIR, { recursive: true })
}
