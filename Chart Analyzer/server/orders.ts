const OPEN_STATES = new Set(["new", "queued", "confirmed", "unconfirmed", "partially_filled"])

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function symbolOf(row: Record<string, unknown>): string {
  const instrument = asRecord(row.instrument)
  const raw = typeof row.symbol === "string" ? row.symbol
    : typeof row.ticker === "string" ? row.ticker
    : typeof instrument?.symbol === "string" ? instrument.symbol
    : ""
  return raw.trim().toUpperCase()
}

function flattenOrders(raw: unknown): Record<string, unknown>[] {
  const rec = asRecord(raw)
  const list = Array.isArray(rec?.results) ? rec.results
    : Array.isArray(rec?.orders) ? rec.orders
    : Array.isArray(raw) ? raw
    : []
  return list.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => Boolean(row))
}

/** Working long-side sell-stops from get_equity_orders pages. Highest stop wins if several are live. */
export function collectOpenStops(payloads: unknown[]): Map<string, number> {
  const byTicker = new Map<string, number>()
  for (const raw of payloads) {
    for (const row of flattenOrders(raw)) {
      const symbol = symbolOf(row)
      const side = String(row.side ?? "").toLowerCase()
      const state = String(row.state ?? "").toLowerCase()
      const trigger = String(row.trigger ?? "").toLowerCase()
      const type = String(row.type ?? "").toLowerCase()
      const stop = num(row.stop_price)
      if (!symbol || side !== "sell" || !OPEN_STATES.has(state)) continue
      if (trigger !== "stop" && !type.includes("stop")) continue
      if (stop == null || !(stop > 0)) continue
      const prev = byTicker.get(symbol)
      if (prev == null || stop > prev) byTicker.set(symbol, stop)
    }
  }
  return byTicker
}

export interface OpenBuyOrder {
  ticker: string
  state: string
  quantity: number
  filledQuantity: number
  type: string
  trigger: string
  stopPrice: number | null
  limitPrice: number | null
}

/** Working buy orders (stop-limit, limit, etc.) waiting to fill. */
export function collectOpenBuys(payloads: unknown[]): OpenBuyOrder[] {
  const byTicker = new Map<string, OpenBuyOrder>()
  for (const raw of payloads) {
    for (const row of flattenOrders(raw)) {
      const ticker = symbolOf(row)
      const side = String(row.side ?? "").toLowerCase()
      const state = String(row.state ?? row.status ?? "").toLowerCase()
      if (!ticker || side !== "buy" || !OPEN_STATES.has(state)) continue
      const rawQty = num(row.quantity) ?? num(row.shares)
      const filledQuantity = num(row.cumulative_quantity) ?? num(row.filled_quantity) ?? 0
      const quantity = rawQty != null && rawQty > 0 ? rawQty : filledQuantity > 0 ? 0 : 1
      const remaining = quantity - filledQuantity
      if (remaining <= 0) continue
      const next: OpenBuyOrder = {
        ticker,
        state,
        quantity: remaining > 0 ? remaining : quantity,
        filledQuantity,
        type: String(row.type ?? ""),
        trigger: String(row.trigger ?? ""),
        stopPrice: num(row.stop_price),
        limitPrice: num(row.price) ?? num(row.limit_price),
      }
      const prev = byTicker.get(ticker)
      if (!prev || next.quantity >= prev.quantity) byTicker.set(ticker, next)
    }
  }
  return [...byTicker.values()]
}

export const OPEN_STOP_STATES = ["confirmed", "queued", "new", "unconfirmed", "partially_filled"] as const
