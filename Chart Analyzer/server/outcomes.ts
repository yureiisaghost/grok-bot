import fs from "node:fs"
import path from "node:path"
import type { OhlcvBar, PlanOfAttack } from "../src/types"
import { ACTIVE_FILE, ARCHIVE_DIR, OUTCOMES_DIR, DESK_DIR, ensureDeskDirs } from "./deskPaths"
import { nowPtStamp } from "./http"
import { fetchDeskDaily } from "./rhMcp"
import { roundPx } from "./indicators"

export const OUTCOME_SCHEMA = "grok-trading-outcome/v1"
export const OUTCOME_RULE_VERSION = "outcome/v1"
export const EXPIRE_SESSIONS = 10

export type OutcomeState = "waiting" | "filled" | "gapped" | "stopped" | "expired"
export type TakeStatus = "open" | "taken" | "skipped"
export type SkipReason =
  | "chase"
  | "blackout"
  | "unstacked-slot"
  | "stop-too-tight"
  | "discretion"
  | "dead"
  | null

export interface OutcomeCard {
  schema: typeof OUTCOME_SCHEMA
  ticker: string
  name: string
  scanDay: string
  scan: number
  setupType: string
  grade: string
  score: number
  warnings: string[]
  lastAtScan: number
  entryPrice: number
  stopPrice: number
  limitCeiling: number
  r1: number | null
  r2: number | null
  r3: number | null
  atr14: number | null
  oneShareRisk: number | null
  stackedAtScan: boolean | null
  takeStatus: TakeStatus
  skipReason: SkipReason
  state: OutcomeState
  filledAt: string | null
  fillPrice: number | null
  stoppedAt: string | null
  expiredAt: string | null
  sessionsSinceScan: number
  maeR: number | null
  mfeR: number | null
  hitR1: boolean
  hitR2: boolean
  hitR3: boolean
  marks: string[]
  updatedAt: string
  ruleVersion: typeof OUTCOME_RULE_VERSION
}

function limitCeiling(trigger: number, atr: number | null) {
  const capPct = trigger * 0.02
  const capAtr = atr != null && atr > 0 ? 0.5 * atr : capPct
  return roundPx(trigger + Math.min(capPct, capAtr))
}

function barDay(bar: OhlcvBar) {
  return bar.time.slice(0, 10)
}

function outcomePath(scanDay: string, ticker: string) {
  return path.join(OUTCOMES_DIR, `${scanDay}_${ticker.toUpperCase()}.json`)
}

function readRegimeStacked(): boolean | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DESK_DIR, "regime.json"), "utf8")) as { stacked?: boolean }
    return typeof raw.stacked === "boolean" ? raw.stacked : null
  } catch {
    return null
  }
}

export function readOutcome(scanDay: string, ticker: string): OutcomeCard | null {
  try {
    const file = outcomePath(scanDay, ticker)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, "utf8")) as OutcomeCard
  } catch {
    return null
  }
}

export function writeOutcome(card: OutcomeCard) {
  ensureDeskDirs()
  fs.mkdirSync(OUTCOMES_DIR, { recursive: true })
  fs.writeFileSync(outcomePath(card.scanDay, card.ticker), JSON.stringify(card, null, 2), "utf8")
}

export function listOutcomeFiles() {
  ensureDeskDirs()
  fs.mkdirSync(OUTCOMES_DIR, { recursive: true })
  return fs.readdirSync(OUTCOMES_DIR).filter((name) => name.endsWith(".json") && !name.startsWith("_"))
}

export function mintCardFromPlan(plan: PlanOfAttack, day: string, scan: number): OutcomeCard | null {
  if (plan.grade !== "Candidate" || plan.entryPrice == null || plan.stopPrice == null) return null
  if (!(plan.entryPrice > plan.stopPrice)) return null
  const existing = readOutcome(day, plan.ticker)
  if (existing) return existing
  const atr = plan.levels?.atr14 ?? null
  const risk = plan.oneShareRisk ?? (plan.entryPrice - plan.stopPrice)
  return {
    schema: OUTCOME_SCHEMA,
    ticker: plan.ticker.toUpperCase(),
    name: plan.name,
    scanDay: day,
    scan,
    setupType: plan.setupType,
    grade: plan.grade,
    score: plan.score,
    warnings: plan.warnings ?? [],
    lastAtScan: plan.lastPrice,
    entryPrice: plan.entryPrice,
    stopPrice: plan.stopPrice,
    limitCeiling: limitCeiling(plan.entryPrice, atr),
    r1: plan.r1,
    r2: plan.r2,
    r3: plan.r3,
    atr14: atr,
    oneShareRisk: risk,
    stackedAtScan: readRegimeStacked(),
    takeStatus: "open",
    skipReason: null,
    state: "waiting",
    filledAt: null,
    fillPrice: null,
    stoppedAt: null,
    expiredAt: null,
    sessionsSinceScan: 0,
    maeR: null,
    mfeR: null,
    hitR1: false,
    hitR2: false,
    hitR3: false,
    marks: [],
    updatedAt: nowPtStamp(),
    ruleVersion: OUTCOME_RULE_VERSION,
  }
}

export function mintOutcomeStubs(input: { day: string; scan: number; plans: PlanOfAttack[] }) {
  const minted: string[] = []
  for (const plan of input.plans) {
    const card = mintCardFromPlan(plan, input.day, input.scan)
    if (!card) continue
    if (!readOutcome(input.day, plan.ticker)) {
      writeOutcome(card)
      minted.push(card.ticker)
    }
  }
  return minted
}

export function stampSkip(scanDay: string, ticker: string, reason: Exclude<SkipReason, null>) {
  const card = readOutcome(scanDay, ticker)
  if (!card) return null
  if (card.takeStatus === "taken") return card
  card.takeStatus = "skipped"
  card.skipReason = reason
  card.updatedAt = nowPtStamp()
  writeOutcome(card)
  return card
}

export function stampTaken(scanDay: string, ticker: string) {
  const card = readOutcome(scanDay, ticker)
  if (!card) return null
  card.takeStatus = "taken"
  card.skipReason = null
  card.updatedAt = nowPtStamp()
  writeOutcome(card)
  return card
}

function rMove(card: OutcomeCard, price: number, fill: number) {
  const risk = card.oneShareRisk && card.oneShareRisk > 0 ? card.oneShareRisk : card.entryPrice - card.stopPrice
  if (!(risk > 0)) return 0
  return (price - fill) / risk
}

/** Replay later sessions onto a frozen card. Never rewrites thesis. */
export function resolveCard(card: OutcomeCard, bars: OhlcvBar[]): OutcomeCard {
  if (card.state === "expired" || card.state === "stopped" || card.state === "gapped") return card
  const later = bars.filter((bar) => barDay(bar) > card.scanDay)
  const next = { ...card, marks: [...card.marks] }
  next.sessionsSinceScan = later.length

  if (next.state === "waiting") {
    for (const bar of later) {
      const day = barDay(bar)
      if (bar.open > next.limitCeiling) {
        next.state = "gapped"
        next.expiredAt = day
        next.marks.push(`${day} gapped ceiling ${next.limitCeiling}`)
        next.updatedAt = nowPtStamp()
        return next
      }
      const crossed = bar.high >= next.entryPrice && bar.open <= next.limitCeiling
      if (!crossed) continue
      const fill = bar.open >= next.entryPrice ? Math.min(bar.open, next.limitCeiling) : next.entryPrice
      next.state = "filled"
      next.filledAt = day
      next.fillPrice = roundPx(fill)
      next.marks.push(`${day} filled ${next.fillPrice}`)
      if (bar.low <= next.stopPrice) {
        next.state = "stopped"
        next.stoppedAt = day
        next.maeR = rMove(next, next.stopPrice, next.fillPrice)
        next.marks.push(`${day} stopped same bar`)
        next.updatedAt = nowPtStamp()
        return next
      }
      break
    }
  }

  if (next.state === "waiting" && later.length >= EXPIRE_SESSIONS) {
    next.state = "expired"
    next.expiredAt = barDay(later[EXPIRE_SESSIONS - 1])
    next.marks.push(`${next.expiredAt} expired no fill`)
    next.updatedAt = nowPtStamp()
    return next
  }

  if (next.state !== "filled" || next.fillPrice == null || !next.filledAt) {
    next.updatedAt = nowPtStamp()
    return next
  }

  const afterFill = later.filter((bar) => barDay(bar) >= next.filledAt!)
  let mae = next.maeR ?? 0
  let mfe = next.mfeR ?? 0
  for (const bar of afterFill) {
    const day = barDay(bar)
    mae = Math.min(mae, rMove(next, bar.low, next.fillPrice))
    mfe = Math.max(mfe, rMove(next, bar.high, next.fillPrice))
    if (next.r1 != null && bar.high >= next.r1) next.hitR1 = true
    if (next.r2 != null && bar.high >= next.r2) next.hitR2 = true
    if (next.r3 != null && bar.high >= next.r3) next.hitR3 = true
    if (bar.low <= next.stopPrice) {
      next.state = "stopped"
      next.stoppedAt = day
      next.maeR = roundPx(mae)
      next.mfeR = roundPx(mfe)
      next.marks.push(`${day} stopped`)
      next.updatedAt = nowPtStamp()
      return next
    }
  }
  next.maeR = roundPx(mae)
  next.mfeR = roundPx(mfe)
  next.updatedAt = nowPtStamp()
  return next
}

export async function resolveOpenOutcomes() {
  const files = listOutcomeFiles()
  const open: OutcomeCard[] = []
  for (const name of files) {
    try {
      const card = JSON.parse(fs.readFileSync(path.join(OUTCOMES_DIR, name), "utf8")) as OutcomeCard
      if (card.state === "waiting" || card.state === "filled") open.push(card)
    } catch {
      /* skip bad file */
    }
  }
  const tickers = [...new Set(open.map((card) => card.ticker))]
  const barsBy = new Map<string, OhlcvBar[]>()
  for (let i = 0; i < tickers.length; i += 8) {
    const chunk = tickers.slice(i, i + 8)
    const got = await fetchDeskDaily(chunk)
    for (const [ticker, bars] of got) barsBy.set(ticker, bars)
  }
  const updated: string[] = []
  for (const card of open) {
    const bars = barsBy.get(card.ticker) ?? []
    const next = resolveCard(card, bars)
    writeOutcome(next)
    updated.push(`${next.ticker}:${next.state}`)
  }
  return { resolved: updated.length, cards: updated, at: nowPtStamp() }
}

export function mintFromActiveScan() {
  try {
    if (!fs.existsSync(ACTIVE_FILE)) return [] as string[]
    const active = JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")) as { day?: string; scan?: number }
    const day = active.day
    const scan = active.scan ?? 1
    if (!day) return []
    const stem = scan <= 1 ? day : `${day}_scan-${scan}`
    const raw = path.join(ARCHIVE_DIR, `${stem}_raw.json`)
    if (!fs.existsSync(raw)) return []
    const data = JSON.parse(fs.readFileSync(raw, "utf8")) as PlanOfAttack[]
    const plans = Array.isArray(data) ? data.filter((plan) => plan?.ticker) : []
    return mintOutcomeStubs({ day, scan, plans })
  } catch {
    return [] as string[]
  }
}
