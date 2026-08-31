import fs from "node:fs"
import os from "node:os"
import path from "node:path"

export const HOME_DIR = path.join(os.homedir(), ".grok-trading")
export const SESSION_PATH = path.join(HOME_DIR, "robinhood.session.json")
export const HOME_ENV_PATH = path.join(HOME_DIR, "robinhood.env")

export interface RobinhoodSession {
  tokenType: string
  accessToken: string
  refreshToken: string
  deviceToken: string
  username: string | null
  savedAt: string
}

export function ensureHomeDir() {
  if (!fs.existsSync(HOME_DIR)) {
    fs.mkdirSync(HOME_DIR, { recursive: true })
  }
}

export function loadSession(): RobinhoodSession | null {
  try {
    if (!fs.existsSync(SESSION_PATH)) return null
    const raw = JSON.parse(fs.readFileSync(SESSION_PATH, "utf8")) as RobinhoodSession
    if (!raw?.accessToken || !raw?.deviceToken) return null
    return raw
  } catch {
    return null
  }
}

export function saveSession(session: RobinhoodSession) {
  ensureHomeDir()
  fs.writeFileSync(SESSION_PATH, JSON.stringify(session, null, 2), "utf8")
}

export function clearSession() {
  if (fs.existsSync(SESSION_PATH)) fs.unlinkSync(SESSION_PATH)
}

export function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, "utf8")
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = value
    }
  }
}

export function loadCredentialsFromDisk() {
  loadEnvFile(HOME_ENV_PATH)
}

export function getEnvCredentials() {
  const username = process.env.ROBINHOOD_USERNAME?.trim() || ""
  const password = process.env.ROBINHOOD_PASSWORD ?? ""
  const totpSecret = process.env.ROBINHOOD_TOTP_SECRET?.trim() || ""
  return { username, password, totpSecret }
}
