import type { AppStatus, ClearResult, DeskSettings, DeskState, PlaceOrderResult, PlanOfAttack, QueueStatus } from "./types"

export class ApiError extends Error {
  code?: string
  authUrl?: string | null
}

function wrapFetchError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof ApiError) throw err
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    const wrapped = new ApiError("Trade Desk server is not running. Keep npm run dev going, then click Run All again.")
    wrapped.code = "unreachable"
    throw wrapped
  }
  throw err instanceof Error ? err : new Error(message)
}

async function parse<T>(res: Response): Promise<T> {
  let data: T & { error?: string; code?: string; authUrl?: string | null }
  try {
    data = await res.json() as T & { error?: string; code?: string; authUrl?: string | null }
  } catch {
    if (!res.ok) {
      const err = new ApiError(`Request failed (${res.status}).`)
      err.code = "server"
      throw err
    }
    throw new ApiError("Trade Desk returned an empty response. Try Run All again.")
  }
  if (!res.ok) {
    const err = new ApiError(data.error || `Request failed (${res.status})`)
    err.code = data.code
    err.authUrl = data.authUrl
    throw err
  }
  return data
}

export function fetchStatus() {
  return fetch("/api/status").then((res) => parse<AppStatus>(res))
}

export async function connectRobinhood() {
  return parse<{ connected: boolean; authUrl: string | null }>(await fetch("/api/mcp/connect", { method: "POST" }))
}

export async function analyzeTicker(ticker: string) {
  const request = () => fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  })
  try {
    return await parse<PlanOfAttack>(await request())
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof ApiError && err.code !== "unreachable" && !/failed to fetch/i.test(message)) throw err
    await new Promise((resolve) => setTimeout(resolve, 800))
    try {
      return await parse<PlanOfAttack>(await request())
    } catch (retryErr) {
      wrapFetchError(retryErr)
    }
  }
}

export async function savePlan(plan: PlanOfAttack, scanId: string) {
  return parse<QueueStatus>(await fetch("/api/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, scanId }),
  }))
}

export async function savePlans(plans: PlanOfAttack[], scanId: string) {
  return parse<QueueStatus>(await fetch("/api/save-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plans, scanId }),
  }))
}

export async function clearQueue() {
  return parse<ClearResult>(await fetch("/api/clear", { method: "POST" }))
}

export function fetchDeskState() {
  return fetch("/api/desk").then((res) => parse<DeskState>(res))
}

export function fetchDeskPlan(ticker: string) {
  return fetch(`/api/desk/plan?ticker=${encodeURIComponent(ticker)}`).then((res) => parse<PlanOfAttack>(res))
}

export function refreshDesk() {
  return fetch("/api/desk/refresh", { method: "POST" }).then((res) => parse<DeskState>(res))
}

export function saveDeskSettings(settings: Partial<DeskSettings>) {
  return fetch("/api/desk/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  }).then((res) => parse<DeskState>(res))
}

export function placePotentialOrder(ticker: string) {
  return fetch("/api/desk/place-order", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  }).then((res) => parse<PlaceOrderResult>(res))
}
