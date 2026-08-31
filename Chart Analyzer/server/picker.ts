import {
  REJECT_LABELS,
  atrToTrigger,
  qualityScore,
  rejectReason,
  type RejectReason,
} from "./finalists"
import type {
  DeskBook,
  DeskPick,
  DeskPosition,
  DeskRegime,
  DeskSettings,
  DeskSkip,
  DeskSnapshot,
  DeskWatch,
  PlanOfAttack,
} from "../src/types"
import { CLUSTER_PCT, closesFromPlan, clusterHeatUsed, clusterTag } from "./cluster"
import { roundPx } from "./indicators"
import type { OpenBuyOrder } from "./orders"

export const DEFAULT_SETTINGS: DeskSettings = {
  riskPct: 1,
  maxHeatPct: 6,
  maxNewNames: 2,
}

export interface BookPosition {
  ticker: string
  quantity: number
  avgCost: number | null
  lastPrice: number | null
  marketValue: number | null
  stopPrice?: number | null
}

export interface AccountBook {
  accountNumber: string | null
  equity: number
  cash: number
  buyingPower: number | null
  positions: BookPosition[]
  openBuys?: OpenBuyOrder[] | null
}

const MIN_ROOM_TO_R1 = 0.7
const MAX_NOTIONAL_ADV = 0.02
const MAX_NOTIONAL_EQUITY = 0.20
const SKIP_PREVIEW = 12

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

function oneShareRisk(plan: PlanOfAttack): number | null {
  const risk = plan.oneShareRisk ?? plan.sizing?.dollarRisk
  if (!finite(risk) || risk <= 0) return null
  return risk
}

function lastPx(plan: PlanOfAttack): number | null {
  return finite(plan.lastPrice) && plan.lastPrice > 0 ? plan.lastPrice : null
}

function dollarAdv(plan: PlanOfAttack): number | null {
  if (finite(plan.dollarAdv) && plan.dollarAdv > 0) return plan.dollarAdv
  const avg = plan.levels?.avgVolume
  const last = lastPx(plan)
  if (finite(avg) && last != null) return avg * last
  return null
}

/** Remaining R from last price to R1, capped by the 52-week high when it sits in the way. */
export function roomToR1(plan: PlanOfAttack): number | null {
  const last = lastPx(plan)
  const r1 = finite(plan.r1) ? plan.r1 : null
  const risk = oneShareRisk(plan)
  if (last == null || r1 == null || risk == null) return null
  const high = finite(plan.levels?.high52) ? plan.levels.high52 : null
  const target = high != null && high > last ? Math.min(r1, high) : r1
  return (target - last) / risk
}

function clampSettings(raw: Partial<DeskSettings> | null | undefined): DeskSettings {
  const riskPct = finite(raw?.riskPct) ? raw.riskPct : DEFAULT_SETTINGS.riskPct
  const maxHeatPct = finite(raw?.maxHeatPct) ? raw.maxHeatPct : DEFAULT_SETTINGS.maxHeatPct
  const maxNewNames = finite(raw?.maxNewNames) ? raw.maxNewNames : DEFAULT_SETTINGS.maxNewNames
  return {
    riskPct: Math.min(5, Math.max(0.25, riskPct)),
    maxHeatPct: Math.min(20, Math.max(1, maxHeatPct)),
    maxNewNames: Math.round(Math.min(5, Math.max(1, maxNewNames))),
  }
}

export { clampSettings }

function skipLabel(reason: RejectReason | string) {
  if (reason in REJECT_LABELS) return REJECT_LABELS[reason as RejectReason]
  return reason.replace(/_/g, " ")
}

function whyLine(plan: PlanOfAttack, shares: number, dollarRisk: number, room: number | null) {
  const atr = atrToTrigger(plan)
  const near = atr == null
    ? "near the trigger"
    : Math.abs(atr) < 0.05
      ? "at the trigger"
      : `${Math.abs(atr).toFixed(1)} ATR ${atr > 0 ? "under" : "through"} the trigger`
  const rBit = room == null ? "1R path on file" : `${room.toFixed(1)}R of room to R1`
  return `${plan.setupType.split(" / ")[0]} · ${near} · ${rBit} · ${shares} sh / $${dollarRisk.toFixed(2)} risk`
}

function heatForPosition(
  pos: BookPosition,
  plan: PlanOfAttack | undefined,
  perNameRisk: number,
): Pick<DeskPosition, "dollarHeat" | "heatNote"> {
  const last = pos.lastPrice ?? plan?.lastPrice ?? pos.avgCost
  const stop = pos.stopPrice ?? plan?.stopPrice
  if (finite(stop) && finite(last) && pos.quantity > 0) {
    const heat = pos.quantity * Math.max(0, last - stop)
    return {
      dollarHeat: heat,
      heatNote: pos.stopPrice != null
        ? (stop >= last ? "at/through broker stop" : "broker stop")
        : (stop >= last ? "at/through scan stop" : "scan stop"),
    }
  }
  return {
    dollarHeat: perNameRisk,
    heatNote: "assumed 1R slot (no stop on file)",
  }
}

function sortPicks(plans: PlanOfAttack[]) {
  return [...plans].sort((a, b) => {
    const qa = a.qualityScore ?? qualityScore(a)
    const qb = b.qualityScore ?? qualityScore(b)
    if (qa !== qb) return qb - qa
    const ra = roomToR1(a) ?? -1
    const rb = roomToR1(b) ?? -1
    if (ra !== rb) return rb - ra
    const da = Math.abs(atrToTrigger(a) ?? 99)
    const db = Math.abs(atrToTrigger(b) ?? 99)
    if (da !== db) return da - db
    return a.ticker.localeCompare(b.ticker)
  })
}

function limitCeiling(trigger: number, atr: number | null) {
  const capPct = trigger * 0.02
  const capAtr = atr != null && atr > 0 ? 0.5 * atr : capPct
  return roundPx(trigger + Math.min(capPct, capAtr))
}

function toPick(
  plan: PlanOfAttack,
  shares: number,
  dollarRisk: number,
  room: number | null,
  equity: number,
  clusterUsed: number,
): DeskPick {
  const last = lastPx(plan) ?? plan.entryPrice ?? 0
  const entry = plan.entryPrice ?? last
  const atr = plan.levels?.atr14 ?? null
  const notional = shares * entry
  return {
    ticker: plan.ticker,
    name: plan.name,
    setupType: plan.setupType,
    grade: plan.grade,
    shares,
    dollarRisk,
    notional,
    notionalPct: equity > 0 ? (notional / equity) * 100 : null,
    entryPrice: entry,
    stopPrice: plan.stopPrice ?? entry - dollarRisk / shares,
    r1: plan.r1,
    lastPrice: last,
    qualityScore: plan.qualityScore ?? qualityScore(plan),
    roomToR1: room,
    why: whyLine(plan, shares, dollarRisk, room),
    thesis: plan.thesis,
    entryMethod: "Buy stop-limit",
    limitCeiling: entry > 0 ? limitCeiling(entry, atr) : null,
    stopKind: "Stop-market",
    clusterTag: clusterTag(plan),
    clusterUsed,
  }
}

export function pickForBook(
  plans: PlanOfAttack[],
  book: AccountBook,
  settingsInput?: Partial<DeskSettings> | null,
  opts?: {
    usedNewList?: boolean
    scan?: DeskSnapshot["scan"]
    refreshedAt?: string
    regime?: DeskRegime | null
    heldCloses?: Record<string, number[]>
    working?: DeskPick[]
  },
): DeskSnapshot {
  const settings = clampSettings(settingsInput)
  const equity = Math.max(0, book.equity)
  const cash = Math.max(0, book.cash)
  const maxHeat = equity * (settings.maxHeatPct / 100)
  const perNameRisk = equity * (settings.riskPct / 100)
  const byTicker = new Map(plans.map((plan) => [plan.ticker.toUpperCase(), plan]))
  const held = new Set(
    book.positions.filter((pos) => pos.quantity > 0).map((pos) => pos.ticker.toUpperCase()),
  )
  const working = (opts?.working ?? []).map((row) => ({
    ...row,
    ticker: row.ticker.toUpperCase(),
  }))
  const workingTickers = new Set(working.map((row) => row.ticker))
  const pendingHeat = working.reduce((sum, row) => sum + (finite(row.dollarRisk) ? row.dollarRisk : 0), 0)

  const extraCloses = new Map(
    Object.entries(opts?.heldCloses ?? {}).map(([ticker, closes]) => [ticker.toUpperCase(), closes]),
  )
  const closesFor = (ticker: string, plan?: PlanOfAttack | null) => {
    const extra = extraCloses.get(ticker.toUpperCase())
    if (extra?.length) return extra
    return closesFromPlan(plan ?? byTicker.get(ticker.toUpperCase()) ?? undefined)
  }

  const positions: DeskPosition[] = book.positions.map((pos) => {
    const heldPlan = byTicker.get(pos.ticker.toUpperCase())
    const heat = heatForPosition(pos, heldPlan, perNameRisk)
    return {
      ticker: pos.ticker,
      quantity: pos.quantity,
      avgCost: pos.avgCost,
      lastPrice: pos.lastPrice,
      marketValue: pos.marketValue ?? (pos.lastPrice != null ? pos.lastPrice * pos.quantity : null),
      dollarHeat: heat.dollarHeat,
      heatNote: heat.heatNote,
      clusterTag: clusterTag(heldPlan),
      stopPrice: pos.stopPrice ?? heldPlan?.stopPrice ?? null,
    }
  })

  const openHeat = positions.reduce((sum, pos) => sum + (pos.dollarHeat ?? 0), 0)
  const deskBook: DeskBook = {
    equity,
    cash,
    buyingPower: book.buyingPower,
    openHeat,
    pendingHeat,
    remainingHeat: Math.max(0, maxHeat - openHeat - pendingHeat),
    maxHeat,
    perNameRisk,
    accountNumber: book.accountNumber,
  }

  const skipped: DeskSkip[] = []
  const nextUp: DeskWatch[] = []
  const eligible: PlanOfAttack[] = []

  for (const plan of plans) {
    if (!plan?.ticker) continue
    if (held.has(plan.ticker.toUpperCase())) {
      skipped.push({ ticker: plan.ticker, reason: "already in the book" })
      continue
    }
    if (workingTickers.has(plan.ticker.toUpperCase())) {
      skipped.push({ ticker: plan.ticker, reason: "order already working" })
      continue
    }
    if (plan.grade === "Developing") {
      nextUp.push({
        ticker: plan.ticker,
        name: plan.name,
        setupType: plan.setupType,
        grade: plan.grade,
        lastPrice: plan.lastPrice,
        qualityScore: plan.qualityScore ?? null,
        note: "Forming — no capital until it is near",
        entryPrice: plan.entryPrice,
        stopPrice: plan.stopPrice,
        r1: plan.r1,
      })
      continue
    }
    const gate = rejectReason(plan)
    if (gate) {
      skipped.push({ ticker: plan.ticker, reason: skipLabel(gate) })
      continue
    }
    const room = roomToR1(plan)
    if (room == null || room < MIN_ROOM_TO_R1) {
      skipped.push({ ticker: plan.ticker, reason: "not enough room to 1R" })
      continue
    }
    eligible.push(plan)
  }

  nextUp.sort((a, b) => (b.qualityScore ?? 0) - (a.qualityScore ?? 0))
  const ranked = sortPicks(eligible)
  const regime = opts?.regime ?? null
  const allowsNewHeat = regime == null || regime.allowsNewHeat
  let remainingHeat = deskBook.remainingHeat
  let remainingCash = cash
  const allocated: DeskPick[] = []
  const allocatedPlans: PlanOfAttack[] = []
  const clusterCap = equity * CLUSTER_PCT

  if (!allowsNewHeat) {
    for (const plan of ranked) {
      skipped.push({ ticker: plan.ticker, reason: "regime — no new heat" })
    }
  } else {
    for (const plan of ranked) {
      if (allocated.length + working.length >= settings.maxNewNames) {
        skipped.push({ ticker: plan.ticker, reason: "not the pick this refresh" })
        continue
      }
      const shareRisk = oneShareRisk(plan)
      const px = plan.entryPrice ?? lastPx(plan)
      if (shareRisk == null || px == null || px <= 0) {
        skipped.push({ ticker: plan.ticker, reason: "missing entry or 1-share risk" })
        continue
      }
      const peers = [
        ...positions.filter((pos) => (pos.dollarHeat ?? 0) > 0).map((pos) => {
          const heldPlan = byTicker.get(pos.ticker.toUpperCase())
          return {
            ticker: pos.ticker,
            heat: pos.dollarHeat ?? 0,
            industry: heldPlan?.industry,
            sector: heldPlan?.sector,
            closes: closesFor(pos.ticker, heldPlan),
          }
        }),
        ...allocatedPlans.map((peer, i) => ({
          ticker: peer.ticker,
          heat: allocated[i].dollarRisk,
          industry: peer.industry,
          sector: peer.sector,
          closes: closesFor(peer.ticker, peer),
        })),
      ]
      const clusterUsed = clusterHeatUsed(plan, peers, closesFor(plan.ticker, plan))
      const clusterRoom = clusterCap - clusterUsed
      const budget = Math.min(perNameRisk, remainingHeat, Math.max(0, clusterRoom))
      let shares = Math.floor(budget / shareRisk)
      if (shares * px > remainingCash) shares = Math.floor(remainingCash / px)
      const maxNotion = equity * MAX_NOTIONAL_EQUITY
      if (equity > 0 && shares * px > maxNotion) shares = Math.floor(maxNotion / px)
      if (shares < 1) {
        const why = clusterRoom < shareRisk
          ? "cluster 2% full"
          : remainingHeat < shareRisk
            ? "leftover heat cannot buy 1 share"
            : remainingCash < px
              ? "leftover cash cannot buy 1 share"
              : "notional cap (20% of equity)"
        skipped.push({ ticker: plan.ticker, reason: why })
        continue
      }
      const notion = shares * px
      const adv = dollarAdv(plan)
      if (adv != null && adv > 0 && notion / adv > MAX_NOTIONAL_ADV) {
        skipped.push({ ticker: plan.ticker, reason: "illiquid at this size" })
        continue
      }
      const dollarRisk = shares * shareRisk
      allocated.push(toPick(plan, shares, dollarRisk, roomToR1(plan), equity, clusterUsed))
      allocatedPlans.push(plan)
      remainingHeat -= dollarRisk
      remainingCash -= notion
    }
  }

  let nothingReason: string | null = null
  let nothingStep: number | null = null
  if (!allocated.length && !working.length) {
    if (!plans.length) {
      nothingStep = 0
      nothingReason = "No screener list yet. Open Screener, run a scan, and save keepers."
    } else if (regime && !regime.allowsNewHeat) {
      nothingStep = regime.status === "pressure" ? 2 : regime.status === "blackout" ? 3 : 1
      nothingReason = regime.reason
    } else if (deskBook.remainingHeat < 0.01) {
      nothingStep = 4
      nothingReason = "Heat is full. No leftover risk for a new name."
    } else if (!eligible.length) {
      nothingStep = 5
      nothingReason = "Nothing on the list is a near Candidate with a real path to 1R that fits this book."
    } else {
      nothingStep = 6
      nothingReason = "The near names do not fit leftover heat, cash, cluster 2%, or 20% notional at 1 share."
    }
  }

  return {
    refreshedAt: opts?.refreshedAt ?? new Date().toISOString(),
    usedNewList: opts?.usedNewList ?? false,
    scan: opts?.scan ?? null,
    regime,
    book: deskBook,
    positions,
    pick: allocated[0] ?? null,
    runnerUp: allocated[1] ?? null,
    working,
    filledFromQueue: [],
    nextUp: nextUp.slice(0, 8),
    skipped: skipped.slice(0, SKIP_PREVIEW),
    skippedCount: skipped.length,
    nothingReason,
    nothingStep,
  }
}
