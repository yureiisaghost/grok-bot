import fs from "node:fs"
import path from "node:path"
import type { DeskPick, HandoffStatus, PlanOfAttack, PotentialOrderRole } from "../src/types"
import { FILLED_TICKERS_DIR, POTENTIAL_TICKERS_DIR, ensureRobinhoodDirs } from "./deskPaths"
import { nowPtStamp } from "./http"
import type { OpenBuyOrder } from "./orders"
import type { BookPosition } from "./picker"

export interface PotentialPacket {
  kind?: string
  status?: string
  queuedAt?: string
  ticker?: string
  role?: PotentialOrderRole
  pick?: DeskPick
  plan?: PlanOfAttack | null
  ticket?: {
    shares?: number
    dollarRisk?: number
    entryPrice?: number
    stopPrice?: number
    limitCeiling?: number
  }
  broker?: OpenBuyOrder | null
  filledAt?: string
  [key: string]: unknown
}

export interface QueueSyncResult {
  working: DeskPick[]
  filledTickers: string[]
}

function fileStem(ticker: string) {
  return ticker.replace(/[^A-Z0-9.-]/g, "_")
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "n/a"
  return `$${n.toFixed(2)}`
}

function headline(status: HandoffStatus) {
  if (status === "filled") return "filled"
  if (status === "pending") return "pending at Robinhood"
  return "queued for Grok"
}

export function ticketMarkdown(packet: {
  status: HandoffStatus
  queuedAt: string
  role: PotentialOrderRole | undefined
  pick: DeskPick
  plan: PlanOfAttack | null | undefined
  broker?: OpenBuyOrder | null
  filledAt?: string
}) {
  const { status, queuedAt, role, pick, plan, broker, filledAt } = packet
  const warnings = plan?.warnings?.length ? plan.warnings.map((w) => `- ${w}`).join("\n") : "- none"
  const roleLabel = role === "runner" ? "Runner-up" : "Desk pick"
  const brokerLines = broker
    ? `
## Broker
- State: ${broker.state}
- Working qty: ${broker.quantity}
- Type: ${broker.type || "n/a"} ${broker.trigger || ""}
- Stop: ${money(broker.stopPrice)}
- Limit: ${money(broker.limitPrice)}
`
    : ""
  return `# ${pick.ticker} — ${headline(status)}

**Queued:** ${queuedAt}
**Status:** ${status}${filledAt ? `
**Filled:** ${filledAt}` : ""}
**Role:** ${roleLabel}
**Name:** ${pick.name}
**Setup:** ${pick.setupType}
**Grade:** ${pick.grade}

## Ticket
- Side: BUY
- Shares: ${pick.shares}
- Entry method: ${pick.entryMethod}
- Entry: ${money(pick.entryPrice)}
- Limit ceiling: ${money(pick.limitCeiling)}
- Stop: ${money(pick.stopPrice)} (${pick.stopKind})
- R1: ${money(pick.r1)}
- Last: ${money(pick.lastPrice)}
- Dollar risk: ${money(pick.dollarRisk)}
- Notional: ${money(pick.notional)}${pick.notionalPct != null ? ` (${pick.notionalPct.toFixed(1)}% of equity)` : ""}
- Cluster: ${pick.clusterTag ?? "n/a"}
${brokerLines}
## Why
${pick.why}

## Thesis
${pick.thesis}

## Plan
${plan?.plan ?? pick.why}

## Entry trigger
${plan?.entryTrigger ?? "n/a"}

## Stop / invalidation
${plan?.stop ?? money(pick.stopPrice)}
${plan?.invalidation ?? ""}

## Earnings
${plan?.earnings ?? "n/a"}${plan?.earnDays != null ? ` · ${plan.earnDays}d` : ""}

## Warnings
${warnings}

---
Trade Desk queued this file for Grok to place and monitor in Robinhood. Do not change shares, stop, or entry method unless the ticket is invalid.
`
}

function writePacket(dir: string, packet: PotentialPacket, pick: DeskPick, status: HandoffStatus) {
  ensureRobinhoodDirs()
  const stem = fileStem(pick.ticker)
  const jsonPath = path.join(dir, `${stem}.json`)
  const mdPath = path.join(dir, `${stem}.md`)
  fs.writeFileSync(jsonPath, JSON.stringify(packet, null, 2), "utf8")
  fs.writeFileSync(mdPath, ticketMarkdown({
    status,
    queuedAt: typeof packet.queuedAt === "string" ? packet.queuedAt : nowPtStamp(),
    role: packet.role,
    pick,
    plan: packet.plan,
    broker: packet.broker,
    filledAt: packet.filledAt,
  }), "utf8")
}

function removePotentialFiles(ticker: string) {
  const stem = fileStem(ticker)
  for (const name of [`${stem}.json`, `${stem}.md`]) {
    const full = path.join(POTENTIAL_TICKERS_DIR, name)
    if (fs.existsSync(full)) fs.unlinkSync(full)
  }
}

export function listQueuedTickers(): string[] {
  return listPotentialPackets().map((row) => row.ticker)
}

export function listPotentialPackets(): Array<{ ticker: string; file: string; packet: PotentialPacket }> {
  try {
    if (!fs.existsSync(POTENTIAL_TICKERS_DIR)) return []
    return fs.readdirSync(POTENTIAL_TICKERS_DIR)
      .filter((name) => /\.json$/i.test(name))
      .flatMap((file) => {
        try {
          const packet = JSON.parse(fs.readFileSync(path.join(POTENTIAL_TICKERS_DIR, file), "utf8")) as PotentialPacket
          const ticker = (packet.ticker ?? packet.pick?.ticker ?? file.replace(/\.json$/i, "")).toUpperCase()
          if (!ticker || !packet.pick) return []
          packet.pick = { ...packet.pick, ticker }
          return [{ ticker, file, packet }]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

function toWorkingPick(packet: PotentialPacket, status: "queued" | "pending", buy: OpenBuyOrder | null): DeskPick {
  const pick = packet.pick!
  const shares = buy?.quantity ?? packet.ticket?.shares ?? pick.shares
  return {
    ...pick,
    shares,
    lastPrice: pick.lastPrice,
    entryPrice: buy?.stopPrice ?? buy?.limitPrice ?? pick.entryPrice,
    limitCeiling: buy?.limitPrice ?? pick.limitCeiling,
    orderStatus: status,
    brokerState: buy?.state ?? null,
  }
}

/** Match Potential Tickers to the live book. Pending stays; fills move to Filled Tickers. */
export function syncPotentialPackets(
  positions: BookPosition[],
  openBuys: OpenBuyOrder[] | null,
): QueueSyncResult {
  const held = new Map(positions.filter((pos) => pos.quantity > 0).map((pos) => [pos.ticker.toUpperCase(), pos]))
  const buys = new Map((openBuys ?? []).map((row) => [row.ticker.toUpperCase(), row]))
  const working: DeskPick[] = []
  const filledTickers: string[] = []
  const stamp = nowPtStamp()

  for (const row of listPotentialPackets()) {
    const { ticker, packet } = row
    const pick = packet.pick
    if (!pick) continue
    const pos = held.get(ticker)
    const buy = openBuys == null ? undefined : buys.get(ticker) ?? null
    const ordersKnown = openBuys != null

    if (pos) {
      const filled: PotentialPacket = {
        ...packet,
        status: "filled",
        filledAt: stamp,
        broker: buy ?? null,
        pick: { ...pick, orderStatus: undefined, brokerState: "filled" },
      }
      writePacket(FILLED_TICKERS_DIR, filled, pick, "filled")
      removePotentialFiles(ticker)
      filledTickers.push(ticker)
      continue
    }

    const status: "queued" | "pending" = !ordersKnown
      ? (packet.status === "pending" ? "pending" : "queued")
      : buy ? "pending" : "queued"
    const next: PotentialPacket = { ...packet, status, broker: buy ?? packet.broker ?? null, ticker }
    writePacket(POTENTIAL_TICKERS_DIR, next, pick, status)
    working.push(toWorkingPick(next, status, buy ?? null))
  }

  return { working, filledTickers }
}
