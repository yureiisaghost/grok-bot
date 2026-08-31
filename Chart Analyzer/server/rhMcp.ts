import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type CallToolResult,
} from "@modelcontextprotocol/client"
import type { OhlcvBar } from "../src/types"
import { DataError, writePack, type MarketPack } from "./market"
import { FileOAuthProvider, MCP_URL } from "./mcpProvider"
import { collectOpenBuys, collectOpenStops, OPEN_STOP_STATES } from "./orders"
import type { AccountBook, BookPosition } from "./picker"

const provider = new FileOAuthProvider()
let client: Client | null = null
let transport: StreamableHTTPClientTransport | null = null

export class NeedsAuthError extends DataError {
  authUrl: string | null
  constructor(authUrl: string | null, message = "Connect Robinhood in this app first (one-time browser login).") {
    super(message, 401, "needs_auth")
    this.authUrl = authUrl
  }
}

function freshTransport() {
  return new StreamableHTTPClientTransport(new URL(MCP_URL), { authProvider: provider })
}

function freshClient() {
  return new Client({ name: "chart-analyzer", version: "1.0.0" })
}

export function mcpStatus() {
  provider.reload()
  return {
    connected: provider.hasTokens(),
    authUrl: provider.pendingAuthUrl ?? null,
  }
}

export async function beginMcpConnect(force = false) {
  provider.reload()
  if (!force && !provider.hasTokens() && provider.pendingAuthUrl) {
    return { connected: false as const, authUrl: provider.pendingAuthUrl }
  }
  if (force) provider.clearPendingFlow()
  await closeMcp()
  transport = freshTransport()
  client = freshClient()
  try {
    await client.connect(transport)
    return { connected: true as const, authUrl: null as string | null }
  } catch (err) {
    if (UnauthorizedError.isInstance(err) || err instanceof UnauthorizedError) {
      return { connected: false as const, authUrl: provider.pendingAuthUrl ?? null }
    }
    throw err
  }
}

export async function finishMcpAuth(params: URLSearchParams) {
  provider.reload()
  const t = freshTransport()
  try {
    await t.finishAuth(params)
  } catch (err) {
    provider.clearPendingFlow()
    const message = err instanceof Error ? err.message : String(err)
    throw new DataError(`Robinhood login did not finish (${message}). Click Connect Robinhood again.`, 400, "auth")
  } finally {
    await t.close().catch(() => undefined)
  }
  const result = await beginMcpConnect()
  if (!result.connected) {
    throw new NeedsAuthError(result.authUrl, "Robinhood connected but session did not start. Click Connect again.")
  }
  return result
}

async function closeMcp() {
  if (client) await client.close().catch(() => undefined)
  if (transport) await transport.close().catch(() => undefined)
  client = null
  transport = null
}

async function ensureClient() {
  if (client && provider.hasTokens()) return client
  const result = await beginMcpConnect()
  if (!result.connected || !client) {
    throw new NeedsAuthError(result.authUrl)
  }
  return client
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function unwrapData(value: unknown): unknown {
  const rec = asRecord(value)
  if (rec && "data" in rec) return rec.data
  return value
}

function parseTool(result: CallToolResult): unknown {
  if (result.isError) {
    const text = result.content?.map((block) => "text" in block ? String(block.text) : "").join(" ")
    throw new DataError(text || "Robinhood MCP tool returned an error.", 502, "robinhood")
  }
  if (result.structuredContent !== undefined) return unwrapData(result.structuredContent)
  const textBlock = result.content?.find((block) => block.type === "text" && "text" in block)
  if (textBlock && "text" in textBlock) {
    try {
      return unwrapData(JSON.parse(String(textBlock.text)))
    } catch {
      return unwrapData(textBlock.text)
    }
  }
  throw new DataError("Robinhood MCP returned an empty result.", 502, "robinhood")
}

let callChain: Promise<unknown> = Promise.resolve()
let cachedAccount: string | null = null
let cachedEquity: number | null | undefined
let equityAt = 0

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = callChain.then(fn, fn)
  callChain = run.then(() => undefined, () => undefined)
  return run
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errText(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function isMissingInstrument(message: string) {
  return /missing_instruments/i.test(message)
}

function isRateLimited(message: string) {
  return /RATE_LIMITED|too many requests|\b429\b/i.test(message)
}

function missingInstrumentError(message: string, args: Record<string, unknown>) {
  const fromJson = message.match(/missing_instruments"\s*:\s*\[\s*"([^"]+)/i)?.[1]
  const fromArgs = Array.isArray(args.symbols)
    ? String(args.symbols[0] ?? "")
    : typeof args.symbol === "string" ? args.symbol : ""
  const symbol = (fromJson || fromArgs).toUpperCase()
  return new DataError(
    symbol ? `${symbol} is not listed on Robinhood.` : "Ticker is not listed on Robinhood.",
    404,
    "not_found",
  )
}

async function invokeTool(name: string, args: Record<string, unknown>) {
  const mcp = await ensureClient()
  const result = await mcp.callTool({ name, arguments: args }, { timeout: 60_000 })
  return parseTool(result)
}

async function invokeWithRetry(name: string, args: Record<string, unknown>) {
  try {
    return await invokeTool(name, args)
  } catch (err) {
    if (err instanceof NeedsAuthError) throw err
    const message = errText(err)
    if (isMissingInstrument(message)) throw missingInstrumentError(message, args)
    if (isRateLimited(message)) {
      for (const wait of [2000, 4000, 8000]) {
        console.warn(`[mcp] ${name} rate limited. Waiting ${wait}ms.`)
        await sleep(wait)
        try {
          return await invokeTool(name, args)
        } catch (retryErr) {
          if (retryErr instanceof NeedsAuthError) throw retryErr
          const retryMsg = errText(retryErr)
          if (isMissingInstrument(retryMsg)) throw missingInstrumentError(retryMsg, args)
          if (!isRateLimited(retryMsg)) throw retryErr
        }
      }
      throw new DataError("Robinhood rate limited this ticker. Click Run All to retry failed names.", 429, "rate_limit")
    }
    console.warn(`[mcp] ${name} failed (${message}). Reconnecting and retrying once.`)
    await closeMcp()
    await sleep(400)
    return await invokeTool(name, args)
  }
}

async function callTool(name: string, args: Record<string, unknown>) {
  return enqueue(() => invokeWithRetry(name, args))
}

/** One ticker at a time, but the independent RH pulls for that ticker run together. */
async function callToolsParallel<T>(work: () => Promise<T>): Promise<T> {
  return enqueue(work)
}

async function loadEquity(): Promise<number | null> {
  if (cachedEquity !== undefined && Date.now() - equityAt < 10 * 60_000) return cachedEquity
  try {
    if (!cachedAccount) {
      const accountsRaw = await callTool("get_accounts", {})
      cachedAccount = pickAccount(accountsRaw) ?? null
    }
    if (!cachedAccount) {
      cachedEquity = null
      equityAt = Date.now()
      return null
    }
    const portfolio = asRecord(await callTool("get_portfolio", { account_number: cachedAccount }))
    cachedEquity = num(portfolio?.total_value) ?? num(portfolio?.cash)
  } catch {
    cachedEquity = null
  }
  equityAt = Date.now()
  return cachedEquity ?? null
}

function barDate(time: string) {
  return time.slice(0, 10)
}

function isStubBar(bar: OhlcvBar) {
  return bar.volume === 0 && bar.open === bar.high && bar.high === bar.low && bar.low === bar.close
}

function mapBars(raw: unknown): OhlcvBar[] {
  const rec = asRecord(raw)
  const results = Array.isArray(rec?.results) ? rec.results : Array.isArray(raw) ? raw : []
  const first = asRecord(results[0])
  const bars = Array.isArray(first?.bars) ? first.bars : []
  return bars.flatMap((row) => mapOneBar(row))
}

function mapOneBar(row: unknown): OhlcvBar[] {
  const b = asRecord(row) ?? {}
  if (b.interpolated === true) return []
  const bar: OhlcvBar = {
    time: String(b.begins_at ?? ""),
    open: Number(b.open_price),
    high: Number(b.high_price),
    low: Number(b.low_price),
    close: Number(b.close_price),
    volume: Number(b.volume ?? 0),
  }
  if (!bar.time || !Number.isFinite(bar.close) || isStubBar(bar)) return []
  return [bar]
}

function mapBarsBySymbol(raw: unknown): Map<string, OhlcvBar[]> {
  const rec = asRecord(raw)
  const results = Array.isArray(rec?.results) ? rec.results : Array.isArray(raw) ? raw : []
  const out = new Map<string, OhlcvBar[]>()
  for (const row of results) {
    const item = asRecord(row)
    const symbol = (str(item?.symbol) ?? "").toUpperCase()
    const bars = Array.isArray(item?.bars) ? item.bars.flatMap(mapOneBar) : []
    if (symbol && bars.length) out.set(symbol, bars)
  }
  return out
}

function overlaySessionBar(
  daily: OhlcvBar[],
  fund: Record<string, unknown>,
  quote: ReturnType<typeof pickQuote>,
): OhlcvBar[] {
  const marketDate = typeof fund.market_date === "string" ? fund.market_date : null
  const open = num(fund.open)
  const high = num(fund.high)
  const low = num(fund.low)
  const volume = num(fund.volume) ?? 0
  if (!marketDate || open === null || high === null || low === null) return daily

  const sessionClose = quote.sessionCloseDate === marketDate
    ? (quote.sessionClose ?? quote.lastReg ?? quote.last)
    : (quote.lastReg ?? quote.sessionClose ?? quote.last)
  const session: OhlcvBar = {
    time: `${marketDate}T00:00:00Z`,
    open,
    high: Math.max(high, sessionClose),
    low: Math.min(low, sessionClose),
    close: sessionClose,
    volume,
  }
  if (isStubBar(session) && volume === 0) return daily

  const idx = daily.findIndex((bar) => barDate(bar.time) === marketDate)
  if (idx >= 0) {
    const existing = daily[idx]
    const next = daily.slice()
    next[idx] = isStubBar(existing) || existing.volume < session.volume
      ? session
      : {
          time: session.time,
          open: existing.open,
          high: Math.max(existing.high, session.high),
          low: Math.min(existing.low, session.low),
          close: session.close,
          volume: Math.max(existing.volume, session.volume),
        }
    return next
  }

  const lastDate = daily.at(-1) ? barDate(daily.at(-1)!.time) : null
  if (!lastDate || lastDate < marketDate) return [...daily, session]
  return daily
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function pickQuote(raw: unknown) {
  const rec = asRecord(raw)
  const results = Array.isArray(rec?.results) ? rec.results : []
  const row = asRecord(results[0])
  const quote = asRecord(row?.quote) ?? {}
  const close = asRecord(row?.close)
  const lastTrade = num(quote.last_trade_price)
  const lastAh = num(quote.last_non_reg_trade_price)
  const officialClose = num(close?.price)
  const officialCloseDate = typeof close?.date === "string" ? close.date : null
  const previousClose = num(quote.adjusted_previous_close) ?? officialClose ?? num(quote.previous_close) ?? lastTrade ?? lastAh ?? 0
  return {
    last: lastTrade ?? lastAh ?? 0,
    lastReg: lastTrade,
    lastAh,
    sessionClose: officialClose ?? lastTrade,
    sessionCloseDate: officialCloseDate,
    officialClose,
    officialCloseDate,
    previousClose,
    bid: num(quote.bid_price),
    ask: num(quote.ask_price),
  }
}

function nextEarnings(raw: unknown, today = new Date().toISOString().slice(0, 10)) {
  const rec = asRecord(raw)
  const results = Array.isArray(rec?.results) ? rec.results : []
  for (const row of results) {
    const item = asRecord(row)
    const report = asRecord(item?.report)
    const eps = asRecord(item?.eps)
    const date = typeof report?.date === "string" ? report.date : null
    if (date && date >= today && eps?.actual == null) return date
  }
  return null
}

function pickAccount(raw: unknown): string | null {
  return pickAccountRow(raw)?.number ?? null
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function pickAccountRow(raw: unknown): { number: string; row: Record<string, unknown> } | null {
  const rec = asRecord(raw)
  const accounts = Array.isArray(rec?.accounts) ? rec.accounts : []
  const mapped = accounts.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row))
  const activeAgentic = mapped.find((a) => a.agentic_allowed === true && a.state === "active" && a.deactivated !== true)
  const fallback = mapped.find((a) => a.is_default === true && a.state === "active") ?? mapped[0]
  const row = activeAgentic ?? fallback
  const number = row && typeof row.account_number === "string" ? row.account_number : null
  return row && number ? { number, row } : null
}

function looksLikeTicker(raw: string) {
  return /^[A-Z][A-Z0-9.]{0,9}$/.test(raw)
}

function collectPositions(value: unknown, out: BookPosition[], seen: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) collectPositions(item, out, seen)
    return
  }
  const rec = asRecord(value)
  if (!rec) return
  const instrument = asRecord(rec.instrument)
  const ticker = (str(rec.symbol) ?? str(rec.ticker) ?? str(instrument?.symbol) ?? "").toUpperCase()
  const quantity = num(rec.quantity) ?? num(rec.shares) ?? num(rec.quantity_available)
  if (ticker && looksLikeTicker(ticker) && quantity != null && Math.abs(quantity) > 0) {
    if (!seen.has(ticker)) {
      seen.add(ticker)
      const lastPrice = num(rec.last_trade_price) ?? num(rec.last_price) ?? num(rec.mark_price) ?? num(rec.current_price)
      const avgCost = num(rec.average_buy_price) ?? num(rec.average_price) ?? num(rec.avg_cost)
      const marketValue = num(rec.market_value) ?? num(rec.equity) ?? (lastPrice != null ? lastPrice * quantity : null)
      out.push({ ticker, quantity, avgCost, lastPrice, marketValue })
    }
    return
  }
  for (const child of Object.values(rec)) collectPositions(child, out, seen)
}

async function listMcpTools() {
  const mcp = await ensureClient()
  const tools: Array<{ name: string; description: string; inputSchema?: unknown }> = []
  let cursor: string | undefined
  do {
    const page = await mcp.listTools(cursor ? { cursor } : undefined)
    for (const tool of page.tools) {
      tools.push({ name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema })
    }
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

function pickPositionTool(tools: Array<{ name: string; description: string }>) {
  const scored = tools
    .filter((tool) => /position|holding/i.test(`${tool.name} ${tool.description}`))
    .filter((tool) => !/option|crypto|order/i.test(tool.name))
  const preferred = scored.find((tool) => /get_positions|get_equity_positions|list_positions/i.test(tool.name))
  return preferred?.name ?? scored[0]?.name ?? "get_positions"
}

export async function fetchAccountBook(): Promise<AccountBook> {
  const accountsRaw = await callTool("get_accounts", {})
  const picked = pickAccountRow(accountsRaw)
  if (!picked) {
    throw new DataError("Robinhood did not return an active account.", 404, "account")
  }

  let portfolio: Record<string, unknown> = {}
  try {
    portfolio = asRecord(await callTool("get_portfolio", { account_number: picked.number })) ?? {}
  } catch {
    portfolio = asRecord(await callTool("get_portfolio", {})) ?? {}
  }

  const equity =
    num(portfolio.total_value)
    ?? num(portfolio.equity)
    ?? num(portfolio.market_value)
    ?? num(portfolio.portfolio_value)
    ?? num(picked.row.buying_power)
    ?? 0
  const cash =
    num(portfolio.cash)
    ?? num(portfolio.cash_available)
    ?? num(portfolio.withdrawable_amount)
    ?? num(picked.row.cash)
    ?? 0
  const buyingPower =
    num(portfolio.buying_power)
    ?? num(picked.row.buying_power)
    ?? num(portfolio.excess_margin)

  cachedAccount = picked.number
  cachedEquity = equity
  equityAt = Date.now()

  let positionsRaw: unknown = []
  try {
    const tools = await enqueue(() => listMcpTools())
    const posTool = pickPositionTool(tools)
    try {
      positionsRaw = await callTool(posTool, { account_number: picked.number })
    } catch {
      positionsRaw = await callTool(posTool, {})
    }
  } catch (err) {
    console.warn(`[mcp] positions failed (${errText(err)}). Desk will use an empty book.`)
  }

  const positions: BookPosition[] = []
  collectPositions(positionsRaw, positions, new Set())
  await fillPositionMarks(positions)
  const openBuys = await fillOpenOrders(picked.number, positions)

  return {
    accountNumber: picked.number,
    equity,
    cash,
    buyingPower,
    positions,
    openBuys,
  }
}

async function fillOpenOrders(accountNumber: string, positions: BookPosition[]) {
  try {
    const pages = await callToolsParallel(() => Promise.all(
      OPEN_STOP_STATES.map((state) =>
        invokeWithRetry("get_equity_orders", { account_number: accountNumber, state }).catch(() => ({ orders: [] })),
      ),
    ))
    const stops = collectOpenStops(pages)
    for (const pos of positions) {
      const stop = stops.get(pos.ticker.toUpperCase())
      if (stop != null) pos.stopPrice = stop
    }
    return collectOpenBuys(pages)
  } catch (err) {
    console.warn(`[mcp] open orders failed (${errText(err)}). Desk will use scan stops only.`)
    return null
  }
}

async function fillPositionMarks(positions: BookPosition[]) {
  const need = [...new Set(positions.filter((pos) => pos.lastPrice == null).map((pos) => pos.ticker))]
  if (!need.length) return
  try {
    const raw = await callTool("get_equity_quotes", { symbols: need })
    const rec = asRecord(raw)
    const results = Array.isArray(rec?.results) ? rec.results : []
    const lastBySymbol = new Map<string, number>()
    for (const row of results) {
      const item = asRecord(row)
      const symbol = (str(item?.symbol) ?? "").toUpperCase()
      const last = pickQuote({ results: [item] }).last
      if (symbol && last > 0) lastBySymbol.set(symbol, last)
    }
    for (const pos of positions) {
      if (pos.lastPrice != null) continue
      const last = lastBySymbol.get(pos.ticker)
      if (last == null) continue
      pos.lastPrice = last
      if (pos.marketValue == null) pos.marketValue = last * pos.quantity
    }
  } catch (err) {
    console.warn(`[mcp] position quotes failed (${errText(err)}).`)
  }
}

let tapeCache: { at: number; qqqDaily: OhlcvBar[]; spyWeekly: OhlcvBar[] } | null = null
let tapeInflight: Promise<{ qqqDaily: OhlcvBar[]; spyWeekly: OhlcvBar[] }> | null = null

/** QQQ daily (6 months) + SPY weekly (2 years) for H3. Cached 15 minutes. */
export async function fetchDeskTape(): Promise<{ qqqDaily: OhlcvBar[]; spyWeekly: OhlcvBar[] }> {
  if (tapeCache && Date.now() - tapeCache.at < 15 * 60_000) return tapeCache
  if (tapeInflight) return tapeInflight
  tapeInflight = (async () => {
    const qqqStart = new Date()
    qqqStart.setUTCMonth(qqqStart.getUTCMonth() - 6)
    const spyStart = new Date()
    spyStart.setUTCFullYear(spyStart.getUTCFullYear() - 2)
    const [qqqRaw, spyRaw] = await callToolsParallel(() => Promise.all([
      invokeWithRetry("get_equity_historicals", {
        symbols: ["QQQ"],
        start_time: qqqStart.toISOString(),
        interval: "day",
        bounds: "regular",
      }),
      invokeWithRetry("get_equity_historicals", {
        symbols: ["SPY"],
        start_time: spyStart.toISOString(),
        interval: "week",
        bounds: "regular",
      }),
    ]))
    const next = { qqqDaily: mapBars(qqqRaw), spyWeekly: mapBars(spyRaw) }
    tapeCache = { at: Date.now(), ...next }
    return next
  })().finally(() => {
    tapeInflight = null
  })
  try {
    return await tapeInflight
  } catch {
    return tapeCache ? { qqqDaily: tapeCache.qqqDaily, spyWeekly: tapeCache.spyWeekly } : { qqqDaily: [], spyWeekly: [] }
  }
}

export async function fetchDeskQuotes(symbols: string[]): Promise<Map<string, { last: number; previousClose: number | null }>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 20)
  const out = new Map<string, { last: number; previousClose: number | null }>()
  if (!uniq.length) return out
  const raw = await callTool("get_equity_quotes", { symbols: uniq })
  const rec = asRecord(raw)
  const results = Array.isArray(rec?.results) ? rec.results : []
  for (const row of results) {
    const item = asRecord(row)
    const symbol = (str(item?.symbol) ?? "").toUpperCase()
    const quote = pickQuote({ results: [item] })
    const last = quote.lastReg != null && quote.lastReg > 0
      ? quote.lastReg
      : (quote.last > 0 ? quote.last : 0)
    if (!symbol || !(last > 0)) continue
    out.set(symbol, { last, previousClose: quote.previousClose > 0 ? quote.previousClose : null })
  }
  return out
}

/** Daily RTH bars for held names (trail / cluster / E10). */
export async function fetchDeskDaily(symbols: string[]): Promise<Map<string, OhlcvBar[]>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 8)
  const out = new Map<string, OhlcvBar[]>()
  if (!uniq.length) return out
  const start = new Date()
  start.setUTCDate(start.getUTCDate() - 120)
  try {
    const raw = await callTool("get_equity_historicals", {
      symbols: uniq,
      start_time: start.toISOString(),
      interval: "day",
      bounds: "regular",
    })
    const bySymbol = mapBarsBySymbol(raw)
    if (bySymbol.size) {
      for (const [symbol, bars] of bySymbol) {
        if (bars.length >= 21) out.set(symbol, bars)
      }
      if (out.size) return out
    }
  } catch (err) {
    console.warn(`[mcp] batch daily bars failed (${errText(err)}). Trying one ticker.`)
  }
  for (const symbol of uniq) {
    if (out.has(symbol)) continue
    try {
      const raw = await callTool("get_equity_historicals", {
        symbols: [symbol],
        start_time: start.toISOString(),
        interval: "day",
        bounds: "regular",
      })
      const bars = mapBars(raw)
      if (bars.length >= 21) out.set(symbol, bars)
    } catch (err) {
      console.warn(`[mcp] daily bars for ${symbol} failed (${errText(err)}).`)
    }
  }
  return out
}

/** 20+ sessions of closes for held names that are not already keepers. */
export async function fetchDeskCloses(symbols: string[]): Promise<Map<string, number[]>> {
  const daily = await fetchDeskDaily(symbols)
  const out = new Map<string, number[]>()
  for (const [symbol, bars] of daily) out.set(symbol, bars.map((bar) => bar.close))
  return out
}

export async function fetchDeskEarnings(symbols: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 8)
  const out = new Map<string, string>()
  const today = new Date().toISOString().slice(0, 10)
  for (const symbol of uniq) {
    try {
      const raw = await invokeWithRetry("get_earnings_results", { symbol })
      const date = nextEarnings(raw, today)
      if (date) out.set(symbol, date)
    } catch (err) {
      console.warn(`[mcp] earnings for ${symbol} failed (${errText(err)}).`)
    }
  }
  return out
}

let spyCache: { at: number; closes: number[] } | null = null
let spyInflight: Promise<number[]> | null = null

async function loadSpyCloses(): Promise<number[]> {
  if (spyCache && Date.now() - spyCache.at < 15 * 60_000) return spyCache.closes
  if (spyInflight) return spyInflight
  spyInflight = (async () => {
    const start = new Date()
    start.setUTCFullYear(start.getUTCFullYear() - 2)
    const raw = await invokeWithRetry("get_equity_historicals", {
      symbols: ["SPY"],
      start_time: start.toISOString(),
      interval: "day",
      bounds: "regular",
    })
    const closes = mapBars(raw).map((b) => b.close)
    spyCache = { at: Date.now(), closes }
    return closes
  })().finally(() => {
    spyInflight = null
  })
  try {
    return await spyInflight
  } catch {
    return spyCache?.closes ?? []
  }
}

function pickInstrument(raw: unknown, symbol: string) {
  const rec = asRecord(raw)
  const list = Array.isArray(rec?.results)
    ? rec.results
    : Array.isArray(rec?.instruments)
      ? rec.instruments
      : Array.isArray(raw) ? raw : []
  const want = symbol.toUpperCase()
  const rows = list.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row))
  const match = rows.find((row) => {
    const inst = asRecord(row.instrument) ?? row
    const sym = (str(inst.symbol) ?? str(row.symbol) ?? "").toUpperCase()
    return sym === want
  }) ?? rows[0]
  if (!match) return { type: null as string | null, name: null as string | null, tradeable: null as boolean | null }
  const inst = asRecord(match.instrument) ?? match
  const type = str(inst.type) ?? str(match.type)
  const name = str(inst.simple_name) ?? str(inst.name) ?? str(match.simple_name) ?? str(match.name)
  const tradability = str(inst.tradability) ?? str(match.tradability)
  const tradeable = inst.tradeable === true || match.tradeable === true || tradability?.toLowerCase() === "tradable"
  return { type, name, tradeable }
}

export async function fetchMarketPack(ticker: string): Promise<MarketPack> {
  const symbol = ticker.toUpperCase()
  const startDaily = new Date()
  startDaily.setUTCFullYear(startDaily.getUTCFullYear() - 2)
  const startWeekly = new Date()
  startWeekly.setUTCFullYear(startWeekly.getUTCFullYear() - 2)

  const [quotesRaw, fundsRaw, dailyRaw, weeklyRaw, earningsRaw, searchRaw, spyCloses] = await callToolsParallel(() => Promise.all([
    invokeWithRetry("get_equity_quotes", { symbols: [symbol] }),
    invokeWithRetry("get_equity_fundamentals", { symbols: [symbol], bounds: "regular" }),
    invokeWithRetry("get_equity_historicals", {
      symbols: [symbol],
      start_time: startDaily.toISOString(),
      interval: "day",
      bounds: "regular",
    }),
    invokeWithRetry("get_equity_historicals", {
      symbols: [symbol],
      start_time: startWeekly.toISOString(),
      interval: "week",
      bounds: "regular",
    }),
    invokeWithRetry("get_earnings_results", { symbol }).catch(() => ({ results: [] })),
    invokeWithRetry("search", { query: symbol }).catch(() => ({ results: [] })),
    loadSpyCloses().catch(() => [] as number[]),
  ]))

  const fundResults = asRecord(fundsRaw)
  const fundList = Array.isArray(fundResults?.results) ? fundResults.results : []
  const fund = asRecord(fundList[0]) ?? {}
  const quote = pickQuote(quotesRaw)
  const daily = overlaySessionBar(mapBars(dailyRaw), fund, quote)
  if (!daily.length) {
    throw new DataError(`No daily history for ${symbol} from Robinhood MCP.`, 404, "not_found")
  }

  const status = typeof fund.financial_status_description === "string" ? fund.financial_status_description : null
  const description = typeof fund.description === "string" ? fund.description : null
  const equity = await loadEquity()
  const instrument = pickInstrument(searchRaw, symbol)

  const pack: MarketPack = {
    ticker: symbol,
    name: instrument.name || symbol,
    quote: {
      last: quote.last,
      previousClose: quote.previousClose,
      bid: quote.bid,
      ask: quote.ask,
      sessionDate: (typeof fund.market_date === "string" ? fund.market_date : null) ?? quote.sessionCloseDate,
      officialClose: quote.officialClose,
      officialCloseDate: quote.officialCloseDate,
    },
    fundamentals: {
      high52: num(fund.high_52_weeks),
      low52: num(fund.low_52_weeks),
      marketCap: num(fund.market_cap),
      float: num(fund.float),
      avgVolume: num(fund.average_volume),
      avgVolume2Weeks: num(fund.average_volume_2_weeks),
      pe: num(fund.pe_ratio),
      sector: typeof fund.sector === "string" ? fund.sector : null,
      industry: typeof fund.industry === "string" ? fund.industry : null,
      description: [status, description].filter(Boolean).join(" — ") || null,
    },
    instrument: { type: instrument.type, tradeable: instrument.tradeable },
    spyCloses: spyCloses.length ? spyCloses : undefined,
    daily,
    weekly: mapBars(weeklyRaw),
    earningsDate: nextEarnings(earningsRaw),
    equity,
    source: "robinhood-trading MCP (app)",
    fetchedAt: new Date().toISOString(),
  }
  return writePack(pack)
}
