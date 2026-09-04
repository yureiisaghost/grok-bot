import fs from "node:fs"
import path from "node:path"
import type { BookMode, DeskPick, HandoffStatus, PlanOfAttack, PotentialOrderRole } from "../src/types"
import { ensureRobinhoodDirs, queueDirs, type QueueDirs } from "./deskPaths"
import { nowPtStamp } from "./http"
import type { OpenBuyOrder } from "./orders"
import type { BookPosition } from "./picker"

export interface PotentialPacket {
  kind?: string
  status?: string
  bookMode?: BookMode
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
  bookMode?: BookMode
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
  const footer = "Queued for Phone Grok to place and monitor in Robinhood after Yurei says take. Do not change shares, stop, or entry method unless the ticket is invalid."
  return `# ${pick.ticker} — ${headline(status)}

**Book:** live cash
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
${footer}
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
    bookMode: packet.bookMode,
  }), "utf8")
}

function removePotentialFiles(ticker: string, dirs: QueueDirs) {
  const stem = fileStem(ticker)
  for (const name of [`${stem}.json`, `${stem}.md`]) {
    const full = path.join(dirs.potential, name)
    if (fs.existsSync(full)) fs.unlinkSync(full)
  }
}

export function listQueuedTickers(mode: BookMode = "live"): string[] {
  return listPotentialPackets(mode).map((row) => row.ticker)
}

export function listPotentialPackets(mode: BookMode = "live"): Array<{ ticker: string; file: string; packet: PotentialPacket }> {
  const dirs = queueDirs(mode)
  try {
    if (!fs.existsSync(dirs.potential)) return []
    return fs.readdirSync(dirs.potential)
      .filter((name) => /\.json$/i.test(name) && !/\s\(\d+\)\.json$/i.test(name))
      .flatMap((file) => {
        try {
          const packet = JSON.parse(fs.readFileSync(path.join(dirs.potential, file), "utf8")) as PotentialPacket
          const ticker = (packet.ticker ?? packet.pick?.ticker ?? file.replace(/\.json$/i, "")).toUpperCase()
          if (!ticker || !packet.pick) return []
          packet.pick = { ...packet.pick, ticker }
          packet.bookMode = packet.bookMode ?? mode
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

/** Match Robinhood/Tickets to the current book. Pending stays; fills move to Robinhood/Filled. */
export function syncPotentialPackets(
  positions: BookPosition[],
  openBuys: OpenBuyOrder[] | null,
  mode: BookMode = "live",
): QueueSyncResult {
  const dirs = queueDirs(mode)
  const held = new Map(positions.filter((pos) => pos.quantity > 0).map((pos) => [pos.ticker.toUpperCase(), pos]))
  const buys = new Map((openBuys ?? []).map((row) => [row.ticker.toUpperCase(), row]))
  const working: DeskPick[] = []
  const filledTickers: string[] = []
  const stamp = nowPtStamp()

  for (const row of listPotentialPackets(mode)) {
    const { ticker, packet } = row
    const pick = packet.pick
    if (!pick) continue
    const pos = held.get(ticker)
    const buy = openBuys == null ? undefined : buys.get(ticker) ?? null
    const ordersKnown = openBuys != null

    if (pos) {
      const filled: PotentialPacket = {
        ...packet,
        bookMode: mode,
        status: "filled",
        filledAt: stamp,
        broker: buy ?? null,
        pick: { ...pick, orderStatus: undefined, brokerState: "filled" },
      }
      writePacket(dirs.filled, filled, pick, "filled")
      removePotentialFiles(ticker, dirs)
      filledTickers.push(ticker)
      continue
    }

    const status: "queued" | "pending" = !ordersKnown
      ? (packet.status === "pending" ? "pending" : "queued")
      : buy ? "pending" : "queued"
    const next: PotentialPacket = {
      ...packet,
      bookMode: mode,
      status,
      broker: buy ?? packet.broker ?? null,
      ticker,
    }
    writePacket(dirs.potential, next, pick, status)
    working.push(toWorkingPick(next, status, buy ?? null))
  }

  return { working, filledTickers }
}
