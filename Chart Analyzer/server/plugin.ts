import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import { buildPlan } from "./analyze"
import { loadDeskPlan, readDeskState, refreshDesk, writeDeskSettings } from "./desk"
import { readHandoff } from "./handoff"
import { readActiveAccount, sessionLabel } from "./accountSnapshot"
import { readJson, sendJson } from "./http"
import { clearQueue, queueMeta, savePlan, savePlans } from "./markdown"
import { DataError, requestTicker } from "./market"
import { queuePotentialOrder, listQueuedTickers } from "./placeOrder"
import { mintFromActiveScan, resolveOpenOutcomes } from "./outcomes"
import { beginMcpConnect, finishMcpAuth, mcpStatus, NeedsAuthError, fetchMarketPack } from "./rhMcp"
import type { DeskSettings, PlanOfAttack } from "../src/types"

function fail(res: ServerResponse, err: unknown) {
  if (err instanceof NeedsAuthError) {
    sendJson(res, err.status, { error: err.message, code: err.code, authUrl: err.authUrl })
    return
  }
  if (err instanceof DataError) {
    sendJson(res, err.status, { error: err.message, code: err.code })
    return
  }
  const message = err instanceof Error ? err.message : String(err)
  sendJson(res, 500, { error: message, code: "server" })
}

function sendHtml(res: ServerResponse, status: number, html: string) {
  res.statusCode = status
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Cache-Control", "no-store")
  res.end(html)
}

async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
  try {
    if (url.pathname === "/api/status" && req.method === "GET") {
      const mcp = mcpStatus()
      const book = readActiveAccount()
      sendJson(res, 200, {
        source: "robinhood-mcp",
        connected: mcp.connected,
        authUrl: mcp.authUrl,
        message: mcp.connected
          ? "Robinhood MCP is connected."
          : "Connect Robinhood once in this app. Tokens stay on this PC, not in Google Drive.",
        queue: queueMeta(),
        book: {
          bookMode: book.bookMode,
          label: sessionLabel(book.bookMode),
          placeCashOrders: book.placeCashOrders,
          equity: book.equity,
          cash: book.cash,
          remainingHeat: book.remainingRoom,
          perNameRisk: book.riskPct,
        },
      })
      return
    }

    if (url.pathname === "/api/mcp/connect" && req.method === "POST") {
      sendJson(res, 200, await beginMcpConnect(true))
      return
    }

    if (url.pathname === "/api/mcp/callback" && req.method === "GET") {
      try {
        await finishMcpAuth(url.searchParams)
        sendHtml(res, 200, `<!doctype html>
<meta charset="utf-8">
<title>Robinhood connected</title>
<p>Robinhood is connected. Returning to Trade Desk…</p>
<script>location.replace("/")</script>`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        sendHtml(res, 400, `<!doctype html>
<meta charset="utf-8">
<title>Connect failed</title>
<p>${message.replace(/[<>&]/g, "")}</p>
<p><a href="/">Back to Trade Desk</a></p>`)
      }
      return
    }

    if (url.pathname === "/api/analyze" && req.method === "POST") {
      const body = await readJson<{ ticker?: string }>(req)
      const ticker = requestTicker(body.ticker ?? "")
      const started = Date.now()
      try {
        const pack = await fetchMarketPack(ticker)
        const fetched = Date.now()
        const plan = buildPlan(pack)
        console.log(`[analyze] ${ticker} ${plan.grade} ${Date.now() - started}ms fetch=${fetched - started}ms grade=${Date.now() - fetched}ms bars=${pack.daily.length}`)
        sendJson(res, 200, plan)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.warn(`[analyze] ${ticker} FAIL ${Date.now() - started}ms ${message}`)
        throw err
      }
      return
    }

    if (url.pathname === "/api/save" && req.method === "POST") {
      const body = await readJson<PlanOfAttack & { plan?: PlanOfAttack; scanId?: string }>(req)
      const plan = body.plan ?? body
      if (!plan?.ticker || !plan.grade) {
        sendJson(res, 400, { error: "Nothing to save. Analyze a ticker first.", code: "validate" })
        return
      }
      const saved = savePlan(plan, body.scanId)
      mintFromActiveScan()
      sendJson(res, 200, saved)
      return
    }

    if (url.pathname === "/api/save-batch" && req.method === "POST") {
      const body = await readJson<{ plans?: PlanOfAttack[]; scanId?: string }>(req)
      const plans = (body.plans ?? []).filter((plan) => plan?.ticker && plan.grade && plan.grade !== "Pass")
      if (!plans.length) {
        sendJson(res, 400, { error: "Nothing to save. Run a queue and pick a batch size.", code: "validate" })
        return
      }
      const saved = savePlans(plans, body.scanId)
      mintFromActiveScan()
      sendJson(res, 200, saved)
      return
    }

    if (url.pathname === "/api/clear" && req.method === "POST") {
      sendJson(res, 200, clearQueue())
      return
    }

    if (url.pathname === "/api/desk" && req.method === "GET") {
      const state = readDeskState()
      sendJson(res, 200, { ...state, queuedTickers: listQueuedTickers(state.settings.bookMode) })
      return
    }

    if (url.pathname === "/api/desk/plan" && req.method === "GET") {
      const ticker = url.searchParams.get("ticker") ?? ""
      const plan = await loadDeskPlan(ticker)
      if (!plan) {
        sendJson(res, 404, { error: `No chart for ${ticker.trim().toUpperCase() || "that ticker"}.`, code: "not_found" })
        return
      }
      sendJson(res, 200, plan)
      return
    }

    if (url.pathname === "/api/desk/refresh" && req.method === "POST") {
      const state = await refreshDesk()
      sendJson(res, 200, { ...state, queuedTickers: listQueuedTickers(state.settings.bookMode) })
      return
    }

    if (url.pathname === "/api/desk/settings" && req.method === "POST") {
      const body = await readJson<Partial<DeskSettings>>(req)
      const settings = writeDeskSettings(body)
      const state = readDeskState()
      sendJson(res, 200, { settings, snapshot: state.snapshot, queuedTickers: listQueuedTickers(settings.bookMode) })
      return
    }

    if (url.pathname === "/api/desk/place-order" && req.method === "POST") {
      const body = await readJson<{ ticker?: string }>(req)
      sendJson(res, 200, await queuePotentialOrder(body.ticker ?? ""))
      return
    }

    if (url.pathname === "/api/handoff" && req.method === "GET") {
      sendJson(res, 200, readHandoff())
      return
    }

    if (url.pathname === "/api/outcomes/resolve" && req.method === "POST") {
      sendJson(res, 200, await resolveOpenOutcomes())
      return
    }

    sendJson(res, 404, { error: "Not found." })
  } catch (err) {
    fail(res, err)
  }
}

export function analyzerApiPlugin(): Plugin {
  const middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const host = req.headers.host ?? "127.0.0.1"
    const url = new URL(req.url ?? "/", `http://${host}`)
    if (!url.pathname.startsWith("/api/")) {
      next()
      return
    }
    void handle(req, res, url)
  }

  return {
    name: "chart-analyzer-api",
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}
