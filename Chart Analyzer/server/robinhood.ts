import { randomUUID } from "node:crypto"
import type { OhlcvBar } from "../src/types"
import {
  clearSession,
  getEnvCredentials,
  loadCredentialsFromDisk,
  loadSession,
  saveSession,
  type RobinhoodSession,
} from "./session"
import { generateTotp } from "./totp"

const CLIENT_ID = "c82SH0WZOsabOXGP2sxqcj34FxkvfnWRZBKlBjFS"
const TOKEN_URL = "https://api.robinhood.com/oauth2/token/"
const USER_AGENT = "*"

export class RobinhoodError extends Error {
  status: number
  code: string
  constructor(message: string, status = 400, code = "robinhood") {
    super(message)
    this.status = status
    this.code = code
  }
}

interface PendingLogin {
  username: string
  password: string
  mfaCode?: string
  deviceToken: string
  workflowId?: string
  createdAt: number
}

let pendingLogin: PendingLogin | null = null
let activeSession: RobinhoodSession | null = null

const packCache = new Map<string, { at: number; pack: MarketPack }>()
const CACHE_MS = 45_000

export interface MarketPack {
  ticker: string
  name: string
  quote: {
    last: number
    previousClose: number
    bid: number | null
    ask: number | null
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
  daily: OhlcvBar[]
  weekly: OhlcvBar[]
  earningsDate: string | null
  equity: number | null
}

function headers(token?: string, form = false): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=1",
    "X-Robinhood-API-Version": "1.431.4",
    Connection: "keep-alive",
    "User-Agent": USER_AGENT,
  }
  if (form) h["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8"
  if (token) h.Authorization = token.startsWith("Bearer") ? token : `Bearer ${token}`
  return h
}

async function rhGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: headers(token) })
  if (res.status === 401) {
    throw new RobinhoodError("Robinhood session expired. Connect again.", 401, "auth")
  }
  if (!res.ok) {
    const text = await res.text()
    throw new RobinhoodError(`Robinhood GET failed (${res.status}): ${text.slice(0, 240)}`, res.status)
  }
  return await res.json() as T
}

function loginPayload(username: string, password: string, deviceToken: string, mfaCode?: string) {
  const payload: Record<string, string | boolean | number> = {
    client_id: CLIENT_ID,
    expires_in: 86400,
    grant_type: "password",
    password,
    scope: "internal",
    username,
    device_token: deviceToken,
    try_passkeys: false,
    token_request_path: "/login",
    create_read_only_secondary_token: true,
  }
  if (mfaCode) payload.mfa_code = mfaCode
  return payload
}

function encodeForm(payload: Record<string, string | boolean | number>) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(payload)) params.set(key, String(value))
  return params
}

interface TokenResponse {
  access_token?: string
  token_type?: string
  refresh_token?: string
  mfa_required?: boolean
  verification_workflow?: { id?: string }
  detail?: string
  error_description?: string
}

async function postToken(payload: Record<string, string | boolean | number>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: headers(undefined, true),
    body: encodeForm(payload),
  })
  const data = await res.json().catch(() => ({})) as TokenResponse
  if (!res.ok && !data.mfa_required && !data.verification_workflow) {
    const message = data.detail || data.error_description || `Login failed (${res.status})`
    throw new RobinhoodError(message, res.status, "auth")
  }
  return data
}

function persistFromToken(data: TokenResponse, deviceToken: string, username: string) {
  if (!data.access_token || !data.refresh_token) {
    throw new RobinhoodError("Robinhood login did not return tokens.", 401, "auth")
  }
  const session: RobinhoodSession = {
    tokenType: data.token_type || "Bearer",
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    deviceToken,
    username,
    savedAt: new Date().toISOString(),
  }
  saveSession(session)
  activeSession = session
  pendingLogin = null
  return session
}

async function refreshSession(session: RobinhoodSession) {
  const data = await postToken({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: session.refreshToken,
    device_token: session.deviceToken,
    expires_in: 86400,
    scope: "internal",
  })
  return persistFromToken(data, session.deviceToken, session.username ?? "")
}

async function validateSession(session: RobinhoodSession) {
  await rhGet("https://api.robinhood.com/accounts/", `${session.tokenType} ${session.accessToken}`)
}

export async function loginWithCredentials(input: {
  username: string
  password: string
  mfaCode?: string
  totpSecret?: string
}) {
  const username = input.username.trim()
  const password = input.password
  if (!username || !password) {
    throw new RobinhoodError("Username and password are required.", 400, "auth")
  }
  const existing = loadSession()
  const deviceToken = existing?.deviceToken || randomUUID()
  let mfa = input.mfaCode?.trim()
  const secret = input.totpSecret?.trim() || getEnvCredentials().totpSecret
  if (!mfa && secret) mfa = generateTotp(secret)

  const data = await postToken(loginPayload(username, password, deviceToken, mfa))
  if (data.mfa_required) {
    pendingLogin = { username, password, mfaCode: mfa, deviceToken, createdAt: Date.now() }
    return { connected: false, mfaRequired: true, username, message: "Enter the authenticator code from Robinhood." }
  }
  if (data.verification_workflow?.id) {
    pendingLogin = {
      username,
      password,
      mfaCode: mfa,
      deviceToken,
      workflowId: data.verification_workflow.id,
      createdAt: Date.now(),
    }
    return {
      connected: false,
      needsDeviceApproval: true,
      username,
      message: "Approve the login in the Robinhood app, then click Continue.",
    }
  }
  persistFromToken(data, deviceToken, username)
  return { connected: true, username, message: "Connected to Robinhood." }
}

export async function continueLogin() {
  if (!pendingLogin || Date.now() - pendingLogin.createdAt > 8 * 60_000) {
    pendingLogin = null
    throw new RobinhoodError("No pending Robinhood login. Connect again.", 400, "auth")
  }
  const { username, password, deviceToken, mfaCode } = pendingLogin
  const data = await postToken(loginPayload(username, password, deviceToken, mfaCode))
  if (data.mfa_required) {
    return { connected: false, mfaRequired: true, username, message: "Enter the authenticator code." }
  }
  if (data.verification_workflow?.id) {
    pendingLogin.workflowId = data.verification_workflow.id
    return {
      connected: false,
      needsDeviceApproval: true,
      username,
      message: "Still waiting on Robinhood app approval. Approve, then Continue again.",
    }
  }
  persistFromToken(data, deviceToken, username)
  return { connected: true, username, message: "Connected to Robinhood." }
}

export async function logoutRobinhood() {
  pendingLogin = null
  activeSession = null
  clearSession()
}

async function ensureSession(): Promise<RobinhoodSession> {
  if (activeSession) {
    try {
      await validateSession(activeSession)
      return activeSession
    } catch {
      try {
        return await refreshSession(activeSession)
      } catch {
        activeSession = null
      }
    }
  }

  const stored = loadSession()
  if (stored) {
    try {
      await validateSession(stored)
      activeSession = stored
      return stored
    } catch {
      try {
        return await refreshSession(stored)
      } catch {
        clearSession()
      }
    }
  }

  loadCredentialsFromDisk()
  const env = getEnvCredentials()
  if (env.username && env.password) {
    const result = await loginWithCredentials({
      username: env.username,
      password: env.password,
      totpSecret: env.totpSecret,
    })
    if (result.connected && activeSession) return activeSession
    throw new RobinhoodError(result.message || "Robinhood login needs approval.", 401, "auth")
  }

  throw new RobinhoodError("Not connected to Robinhood. Use Connect first.", 401, "auth")
}

export async function getAuthStatus() {
  try {
    const session = await ensureSession()
    return { connected: true, username: session.username }
  } catch (err) {
    if (pendingLogin) {
      return {
        connected: false,
        username: pendingLogin.username,
        mfaRequired: !pendingLogin.workflowId,
        needsDeviceApproval: Boolean(pendingLogin.workflowId),
        message: pendingLogin.workflowId
          ? "Approve the login in the Robinhood app, then Continue."
          : "Enter your authenticator code.",
      }
    }
    return {
      connected: false,
      username: null,
      message: err instanceof Error ? err.message : "Not connected.",
    }
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function mapHistoricals(rows: Array<Record<string, unknown>> | undefined): OhlcvBar[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => ({
      time: String(row.begins_at ?? ""),
      open: Number(row.open_price),
      high: Number(row.high_price),
      low: Number(row.low_price),
      close: Number(row.close_price),
      volume: Number(row.volume ?? 0),
    }))
    .filter((bar) => bar.time && Number.isFinite(bar.close) && bar.close > 0)
}

async function fetchHistoricals(token: string, symbol: string, interval: string, span: string) {
  const url = `https://api.robinhood.com/quotes/historicals/?symbols=${encodeURIComponent(symbol)}&interval=${interval}&span=${span}&bounds=regular`
  const data = await rhGet<{ results?: Array<{ symbol?: string; historicals?: Array<Record<string, unknown>> }> }>(url, token)
  const row = data.results?.[0]
  return mapHistoricals(row?.historicals)
}

function nextEarningsDate(rows: Array<Record<string, unknown>> | undefined) {
  if (!Array.isArray(rows)) return null
  const today = new Date().toISOString().slice(0, 10)
  const dates = rows
    .map((row) => {
      const report = row.report as { date?: string } | undefined
      return report?.date || null
    })
    .filter((d): d is string => Boolean(d))
    .sort()
  return dates.find((d) => d >= today) ?? null
}

export async function fetchMarketPack(ticker: string): Promise<MarketPack> {
  const symbol = ticker.toUpperCase()
  const cached = packCache.get(symbol)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.pack

  const session = await ensureSession()
  const token = `${session.tokenType} ${session.accessToken}`

  const [quoteWrap, fundWrap, daily, weekly, earningsWrap, portfolios] = await Promise.all([
    rhGet<{ results?: Array<Record<string, unknown>> }>(
      `https://api.robinhood.com/quotes/?symbols=${encodeURIComponent(symbol)}`,
      token,
    ),
    rhGet<{ results?: Array<Record<string, unknown>> }>(
      `https://api.robinhood.com/fundamentals/?symbols=${encodeURIComponent(symbol)}`,
      token,
    ),
    fetchHistoricals(token, symbol, "day", "5year"),
    fetchHistoricals(token, symbol, "week", "5year"),
    rhGet<{ results?: Array<Record<string, unknown>> }>(
      `https://api.robinhood.com/marketdata/earnings/?symbol=${encodeURIComponent(symbol)}`,
      token,
    ).catch(() => ({ results: [] })),
    rhGet<{ results?: Array<Record<string, unknown>> }>("https://api.robinhood.com/portfolios/", token).catch(() => ({ results: [] })),
  ])

  const quote = quoteWrap.results?.[0]
  const fund = fundWrap.results?.[0]
  if (!quote) throw new RobinhoodError(`No Robinhood quote for ${symbol}.`, 404, "not_found")

  let name = symbol
  try {
    const inst = await rhGet<{ results?: Array<{ simple_name?: string; name?: string }> }>(
      `https://api.robinhood.com/instruments/?symbol=${encodeURIComponent(symbol)}`,
      token,
    )
    name = inst.results?.[0]?.simple_name || inst.results?.[0]?.name || symbol
  } catch {
    name = symbol
  }

  const last = num(quote.last_trade_price) ?? num(quote.last_extended_hours_trade_price) ?? 0
  const previousClose = num(quote.previous_close) ?? num(quote.adjusted_previous_close) ?? last
  const equity = num(portfolios.results?.[0]?.equity) ?? num(portfolios.results?.[0]?.extended_hours_equity)

  if (!daily.length) throw new RobinhoodError(`No daily history for ${symbol}.`, 404, "not_found")

  const pack: MarketPack = {
    ticker: symbol,
    name,
    quote: {
      last,
      previousClose,
      bid: num(quote.bid_price),
      ask: num(quote.ask_price),
    },
    fundamentals: {
      high52: num(fund?.high_52_weeks),
      low52: num(fund?.low_52_weeks),
      marketCap: num(fund?.market_cap),
      float: num(fund?.float),
      avgVolume: num(fund?.average_volume),
      avgVolume2Weeks: num(fund?.average_volume_2_weeks),
      pe: num(fund?.pe_ratio),
      sector: typeof fund?.sector === "string" ? fund.sector : null,
      industry: typeof fund?.industry === "string" ? fund.industry : null,
      description: typeof fund?.description === "string" ? fund.description : null,
    },
    daily,
    weekly,
    earningsDate: nextEarningsDate(earningsWrap.results),
    equity,
  }
  packCache.set(symbol, { at: Date.now(), pack })
  return pack
}
