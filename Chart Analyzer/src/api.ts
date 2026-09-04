import type { AppStatus, DeskSettings, DeskState, HandoffManifest, PlaceOrderResult, PlanOfAttack } from "./types"

export class ApiError extends Error {
  code?: string
  authUrl?: string | null
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
    throw new ApiError("Trade Desk returned an empty response.")
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

export function fetchHandoff() {
  return fetch("/api/handoff").then((res) => parse<HandoffManifest>(res))
}
