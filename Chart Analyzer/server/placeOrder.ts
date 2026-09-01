import fs from "node:fs"
import path from "node:path"
import type { DeskPick, DeskSnapshot, PlaceOrderResult, PotentialOrderRole } from "../src/types"
import { readDeskPlan, readDeskState, noteWorkingPick } from "./desk"
import { ensureRobinhoodDirs, queueDirs } from "./deskPaths"
import { writeHandoff } from "./handoff"
import { nowPtStamp } from "./http"
import { DataError, requestTicker } from "./market"
import { addPaperPending } from "./paperAccount"
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
  const state = readDeskState()
  const snapshot = state.snapshot
  const bookMode = state.settings.bookMode
  if (!snapshot) {
    throw new DataError("Refresh the desk first, then Place Order on a Potential.", 400, "validate")
  }
  const matched = pickForTicker(snapshot, ticker)
  if (!matched) {
    throw new DataError(`${ticker} is not a current Potential (pick or runner-up).`, 400, "validate")
  }

  const plan = readDeskPlan(ticker)
  const queuedAt = nowPtStamp()
  const paper = bookMode === "paper"
  const status = paper ? "pending" as const : "queued" as const
  const dirs = queueDirs(bookMode)
  const packet = {
    kind: "potential-order" as const,
    status,
    bookMode,
    queuedAt,
    ticker,
    role: matched.role,
    source: "trade-desk",
    driveFolder: dirs.drivePotential,
    instruction: paper
      ? "PAPER. Do not place this order in Robinhood cash. Trade Desk fills it on Refresh when last trades through the trigger."
      : "Place and monitor this order in Robinhood from the ticket below. Do not change the share count, stop, or entry method unless the ticket is invalid.",
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
    pick: { ...matched.pick, orderStatus: status, brokerState: paper ? "paper" : null },
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
  fs.writeFileSync(path.join(dirs.potential, jsonFile), JSON.stringify(packet, null, 2), "utf8")
  fs.writeFileSync(path.join(dirs.potential, mdFile), ticketMarkdown({
    status,
    queuedAt,
    role: matched.role,
    pick: packet.pick,
    plan,
    bookMode,
  }), "utf8")

  if (paper) addPaperPending(matched.pick, matched.role, queuedAt)
  noteWorkingPick(packet.pick, status)

  writeHandoff("place-order")

  return {
    ticker,
    role: matched.role,
    bookMode,
    path: dirs.potential,
    driveFolder: dirs.drivePotential,
    jsonFile,
    mdFile,
    queuedAt,
  }
}

export { listQueuedTickers } from "./potentialQueue"
