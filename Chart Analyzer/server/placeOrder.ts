import fs from "node:fs"
import path from "node:path"
import type { DeskPick, DeskSnapshot, PlaceOrderResult, PotentialOrderRole } from "../src/types"
import { readDeskPlan, readDeskState } from "./desk"
import { POTENTIAL_TICKERS_DIR, ensureRobinhoodDirs } from "./deskPaths"
import { nowPtStamp } from "./http"
import { DataError, requestTicker } from "./market"
import { ticketMarkdown } from "./potentialQueue"

function fileStem(ticker: string) {
  return ticker.replace(/[^A-Z0-9.-]/g, "_")
}

function pickForTicker(snapshot: DeskSnapshot, ticker: string): { role: PotentialOrderRole; pick: DeskPick } | null {
  if (snapshot.pick?.ticker.toUpperCase() === ticker) return { role: "pick", pick: snapshot.pick }
  if (snapshot.runnerUp?.ticker.toUpperCase() === ticker) return { role: "runner", pick: snapshot.runnerUp }
  const working = (snapshot.working ?? []).find((row) => row.ticker.toUpperCase() === ticker)
  if (working) return { role: "pick", pick: working }
  return null
}

export async function queuePotentialOrder(rawTicker: string): Promise<PlaceOrderResult> {
  const ticker = requestTicker(rawTicker)
  const snapshot = readDeskState().snapshot
  if (!snapshot) {
    throw new DataError("Refresh the desk first, then Place Order on a Potential.", 400, "validate")
  }
  const matched = pickForTicker(snapshot, ticker)
  if (!matched) {
    throw new DataError(`${ticker} is not a current Potential (pick or runner-up).`, 400, "validate")
  }

  const plan = readDeskPlan(ticker)
  const queuedAt = nowPtStamp()
  const packet = {
    kind: "potential-order" as const,
    status: "queued" as const,
    queuedAt,
    ticker,
    role: matched.role,
    source: "trade-desk",
    instruction: "Place and monitor this order in Robinhood from the ticket below. Do not change the share count, stop, or entry method unless the ticket is invalid.",
    ticket: {
      side: "buy" as const,
      shares: matched.pick.shares,
      entryMethod: matched.pick.entryMethod,
      entryPrice: matched.pick.entryPrice,
      limitCeiling: matched.pick.limitCeiling,
      stopPrice: matched.pick.stopPrice,
      stopKind: matched.pick.stopKind,
      r1: matched.pick.r1,
      r2: plan?.r2 ?? null,
      r3: plan?.r3 ?? null,
      dollarRisk: matched.pick.dollarRisk,
      notional: matched.pick.notional,
      lastPrice: matched.pick.lastPrice,
    },
    pick: { ...matched.pick, orderStatus: "queued" as const, brokerState: null },
    plan,
    book: snapshot.book,
    regime: snapshot.regime,
    scan: snapshot.scan,
    refreshedAt: snapshot.refreshedAt,
  }

  ensureRobinhoodDirs()
  const stem = fileStem(ticker)
  const jsonFile = `${stem}.json`
  const mdFile = `${stem}.md`
  fs.writeFileSync(path.join(POTENTIAL_TICKERS_DIR, jsonFile), JSON.stringify(packet, null, 2), "utf8")
  fs.writeFileSync(path.join(POTENTIAL_TICKERS_DIR, mdFile), ticketMarkdown({
    status: "queued",
    queuedAt,
    role: matched.role,
    pick: packet.pick,
    plan,
  }), "utf8")

  return {
    ticker,
    role: matched.role,
    path: POTENTIAL_TICKERS_DIR,
    jsonFile,
    mdFile,
    queuedAt,
  }
}

export { listQueuedTickers } from "./potentialQueue"
