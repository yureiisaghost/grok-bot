import type { Grade, PlanOfAttack, Readiness } from "../src/types"
import { sizeFromAccount, type AccountSnapshot } from "./accountSnapshot"
import { SCORE_WEIGHTS, finalistConfig, type FinalistConfig } from "./finalistConfig"
import { sessionRangePct } from "./stopWriter"
import { closesFromBars, priorThrust60d } from "./thrust"

export const REJECT_REASONS = [
  "not_candidate",
  "not_near",
  "weekly_down",
  "earnings",
  "risk_missing",
  "cannot_size",
  "risk_vs_atr",
  "risk_vs_atr_high",
  "stop_too_wide_pct",
  "no_prior_thrust",
  "below_50",
  "flag_too_deep",
  "dead_tape",
  "illiquid_at_size",
  "no_trigger",
  "too_far_under",
  "chase_through",
] as const

export type RejectReason = (typeof REJECT_REASONS)[number]

export type SetupKind = "flag" | "vcp" | "ma" | "none"

export const REJECT_LABELS: Record<RejectReason, string> = {
  not_candidate: "not Candidate",
  not_near: "not near",
  weekly_down: "weekly down",
  earnings: "earnings window",
  risk_missing: "no 1-share risk",
  cannot_size: "cannot size on this book",
  risk_vs_atr: "risk vs ATR floor",
  risk_vs_atr_high: "risk vs ATR ceiling",
  stop_too_wide_pct: "stop too wide %",
  no_prior_thrust: "no prior thrust",
  below_50: "below 50 EMA",
  flag_too_deep: "flag too deep",
  dead_tape: "dead tape",
  illiquid_at_size: "illiquid at size",
  no_trigger: "no trigger",
  too_far_under: "too far under trigger",
  chase_through: "extended through trigger",
}

export type FamilyCounts = Record<Exclude<SetupKind, "none">, number>

export interface FinalistResult {
  finalists: PlanOfAttack[]
  warehouse: PlanOfAttack[]
  rawCount: number
  tallies: Record<RejectReason, number>
  familyLanded: FamilyCounts
  mixCapped: FamilyCounts
}

export function setupKind(setupType: string | undefined): SetupKind {
  const t = setupType ?? ""
  if (t.startsWith("Bull Flag")) return "flag"
  if (t.startsWith("VCP")) return "vcp"
  if (t.startsWith("MA Pullback")) return "ma"
  return "none"
}

function gradeOf(plan: PlanOfAttack): Grade {
  const grade = plan.grade as string
  if (grade === "Live") return "Candidate"
  if (grade === "Early Watch") return "Developing"
  if (grade === "Candidate" || grade === "Developing" || grade === "Pass") return grade
  return "Pass"
}

function readinessOf(plan: PlanOfAttack): Readiness {
  if (plan.readiness) return plan.readiness
  const grade = gradeOf(plan)
  if (grade === "Pass") return "none"
  if (grade === "Developing") return "forming"
  return "near"
}

function oneShareRisk(plan: PlanOfAttack): number | null {
  const risk = plan.oneShareRisk ?? plan.sizing?.dollarRisk
  if (risk == null || !Number.isFinite(risk) || risk <= 0) return null
  return risk
}

function atrValue(plan: PlanOfAttack): number | null {
  const atr = plan.levels?.atr14
  if (atr == null || !Number.isFinite(atr) || atr <= 0) return null
  return atr
}

function lastPrice(plan: PlanOfAttack): number | null {
  if (!Number.isFinite(plan.lastPrice) || plan.lastPrice <= 0) return null
  return plan.lastPrice
}

function triggerPrice(plan: PlanOfAttack): number | null {
  if (plan.entryPrice == null || !Number.isFinite(plan.entryPrice) || plan.entryPrice <= 0) return null
  return plan.entryPrice
}

function dollarAdvOf(plan: PlanOfAttack): number | null {
  if (plan.dollarAdv != null && Number.isFinite(plan.dollarAdv) && plan.dollarAdv > 0) return plan.dollarAdv
  const avg = plan.levels?.avgVolume
  const last = lastPrice(plan)
  if (avg != null && Number.isFinite(avg) && last != null) return avg * last
  return null
}

function stopPctOf(plan: PlanOfAttack): number | null {
  if (plan.stopPct != null && Number.isFinite(plan.stopPct)) return plan.stopPct
  const risk = oneShareRisk(plan)
  const last = lastPrice(plan)
  if (risk == null || last == null) return null
  return (risk / last) * 100
}

function stopAtrOf(plan: PlanOfAttack): number | null {
  if (plan.stopAtrMultiple != null && Number.isFinite(plan.stopAtrMultiple)) return plan.stopAtrMultiple
  const risk = oneShareRisk(plan)
  const atr = atrValue(plan)
  if (risk == null || atr == null) return null
  return risk / atr
}

/** Positive = under trigger. Negative = through / above trigger. */
export function atrToTrigger(plan: PlanOfAttack): number | null {
  const geo = plan.geometry?.atrToLevel
  if (geo != null && Number.isFinite(geo)) return geo
  const atr = atrValue(plan)
  const last = lastPrice(plan)
  const trigger = triggerPrice(plan)
  if (atr == null || last == null || trigger == null) return null
  return (trigger - last) / atr
}

/** Positive = percent under trigger. */
export function pctToTrigger(plan: PlanOfAttack): number | null {
  const geo = plan.geometry?.pctToLevel
  if (geo != null && Number.isFinite(geo)) return geo
  const last = lastPrice(plan)
  const trigger = triggerPrice(plan)
  if (last == null || trigger == null) return null
  return ((trigger - last) / last) * 100
}

export function thrustFromPlan(plan: PlanOfAttack, floorPct: number) {
  const computed = priorThrust60d(closesFromBars(plan.chart), floorPct)
  if (computed) return computed
  return null
}

function deadTape(plan: PlanOfAttack, minAdv: number): boolean {
  const last = lastPrice(plan)
  const atr = atrValue(plan)
  if (last != null && atr != null && atr / last < 0.004) return true
  const high = plan.levels?.high52
  const low = plan.levels?.low52
  if (
    last != null
    && high != null && Number.isFinite(high)
    && low != null && Number.isFinite(low)
    && (high - low) / last < 0.08
  ) return true
  const dollar = dollarAdvOf(plan)
  if (dollar != null && Number.isFinite(dollar)) return dollar < 1_000_000
  const avg = plan.levels?.avgVolume
  if (avg != null && Number.isFinite(avg) && avg < minAdv) return true
  return false
}

function distanceReject(plan: PlanOfAttack): Extract<RejectReason, "no_trigger" | "too_far_under" | "chase_through"> | null {
  const trigger = triggerPrice(plan)
  if (trigger == null) return "no_trigger"
  const atrDist = atrToTrigger(plan)
  if (atrDist != null) {
    if (atrDist >= 1.5) return "too_far_under"
    if (atrDist < -0.5) return "chase_through"
    return null
  }
  const pctDist = pctToTrigger(plan)
  if (pctDist == null) return "no_trigger"
  if (pctDist >= 10) return "too_far_under"
  if (pctDist < -1) return "chase_through"
  return null
}

function plannedNotional(plan: PlanOfAttack): number | null {
  if (plan.plannedSharesAtRoom == null || plan.entryPrice == null) return null
  if (!Number.isFinite(plan.plannedSharesAtRoom) || !Number.isFinite(plan.entryPrice)) return null
  if (plan.plannedSharesAtRoom < 1 || plan.entryPrice <= 0) return null
  return plan.plannedSharesAtRoom * plan.entryPrice
}

export function rejectReason(
  plan: PlanOfAttack,
  cfg: FinalistConfig = finalistConfig(),
): RejectReason | null {
  if (gradeOf(plan) !== "Candidate") return "not_candidate"
  if (readinessOf(plan) !== "near") return "not_near"
  if (plan.weeklyTrend === "down") return "weekly_down"
  if (plan.earnDays != null && plan.earnDays <= cfg.earnDays) return "earnings"
  const risk = oneShareRisk(plan)
  if (risk == null) return "risk_missing"
  const atr = atrValue(plan)
  if (atr != null && risk < cfg.minStopAtr * atr) return "risk_vs_atr"
  if (atr != null && risk > cfg.maxStopAtr * atr) return "risk_vs_atr_high"
  const kind = setupKind(plan.setupType)
  const stopPct = stopPctOf(plan)
  if (stopPct != null && stopPct > cfg.maxStopPct) {
    return "stop_too_wide_pct"
  }
  if (kind === "flag" || kind === "vcp") {
    const thrust = thrustFromPlan(plan, cfg.priorThrustPct)
    if (!thrust || !thrust.pass) return "no_prior_thrust"
    const ema50 = plan.levels?.ema50
    const last = lastPrice(plan)
    if (ema50 != null && last != null && last < ema50) return "below_50"
  }
  if (kind === "flag" && plan.flagRetracePct != null && plan.flagRetracePct > 50) {
    return "flag_too_deep"
  }
  if (deadTape(plan, cfg.minAdvShares)) return "dead_tape"
  const notion = plannedNotional(plan)
  const adv = dollarAdvOf(plan)
  if (notion != null && adv != null && adv > 0 && notion / adv > cfg.maxNotionalAdv) {
    return "illiquid_at_size"
  }
  return distanceReject(plan)
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function monthPerf(plan: PlanOfAttack): number | null {
  const bars = plan.chart
  if (!bars || bars.length < 22) return null
  const prev = bars[bars.length - 22].close
  const last = bars[bars.length - 1].close
  if (!(prev > 0)) return null
  return ((last - prev) / prev) * 100
}

function slopeEma50(plan: PlanOfAttack): number | null {
  const series = plan.ema50Series
  if (!series || series.length < 10) return null
  const a = series[series.length - 9]
  const b = series[series.length - 1]
  if (a == null || b == null || !(a > 0)) return null
  return (b - a) / a
}

function volDryFlag(plan: PlanOfAttack): boolean {
  const bars = plan.chart
  if (!bars || bars.length < 25) return false
  const flag = bars.slice(-12)
  const pole = bars.slice(-24, -12)
  const flagVol = flag.reduce((a, b) => a + b.volume, 0) / flag.length
  const poleVol = pole.reduce((a, b) => a + b.volume, 0) / pole.length
  return poleVol > 0 && flagVol < poleVol * 0.85
}

function distributionDay(plan: PlanOfAttack): boolean {
  const bars = plan.chart
  if (!bars || bars.length < 20) return false
  const window = bars.slice(-15)
  const avg = window.reduce((a, b) => a + b.volume, 0) / window.length
  return window.some((bar) => bar.close < bar.open && avg > 0 && bar.volume > avg * 1.6)
}

function smashBounce(plan: PlanOfAttack): boolean {
  const last = lastPrice(plan)
  if (last == null || !plan.chart?.length) return false
  return sessionRangePct(plan.chart, 10, last) >= 0.25
}

function patternScore(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.pattern
  const kind = setupKind(plan.setupType)
  const stopPct = stopPctOf(plan)
  let pts = 6
  if (kind === "flag") {
    const retrace = plan.flagRetracePct
    pts = 8
    if (retrace != null) {
      if (retrace >= 20 && retrace <= 38) pts = 14
      else if (retrace > 38 && retrace <= 50) pts = 8
      else pts = 3
    }
    if (plan.entryMethod.toLowerCase().includes("stop")) pts += 6
    if (plan.readiness === "near") pts += 5
  } else if (kind === "vcp") {
    pts = 10
    if ((plan.thesis || "").toLowerCase().includes("tight")) pts += 5
    if (plan.readiness === "near") pts += 5
    if (plan.entryMethod.toLowerCase().includes("stop")) pts += 5
  } else if (kind === "ma") {
    const reclaim = /reclaim/i.test(plan.thesis) || /reclaim/i.test(plan.entryTrigger)
    pts = reclaim ? 18 : 10
    if (plan.readiness === "near") pts += 5
    if (/limit/i.test(plan.entryMethod) && /20 ema/i.test(plan.entryTrigger)) pts = 4
    if (smashBounce(plan)) pts = Math.min(pts, 10)
  }
  if (stopPct != null && stopPct > 8) pts -= 4
  return clamp(pts, 0, cap)
}

function volumeScore(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.volume
  const kind = setupKind(plan.setupType)
  const rel = plan.levels?.relativeVolume
  let pts = 8
  if (kind === "flag" || kind === "vcp") {
    if (volDryFlag(plan)) pts += 8
    if (distributionDay(plan)) pts -= 8
    if (rel != null && rel < 1.1) pts += 4
  } else {
    if (rel != null && rel < 2) pts += 6
    if (distributionDay(plan)) pts -= 6
  }
  return clamp(pts, 0, cap)
}

function rsStageScore(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.rsStage
  let pts = 0
  if (plan.rsRaw != null) {
    if (plan.rsRaw > 0) pts += 10
  } else if (plan.rsSlope20 != null) {
    if (plan.rsSlope20 > 0) pts += 10
  } else {
    const perf = monthPerf(plan)
    if (perf != null && perf > 0) pts += 10
  }
  if (plan.spyBeat === true) pts += 6
  else if (plan.spyBeat === false) pts -= 4
  const last = lastPrice(plan)
  const e50 = plan.levels?.ema50
  const e20 = plan.levels?.ema20
  if (last != null && e50 != null && last > e50) pts += 6
  if (last != null && e20 != null && last > e20) pts += 4
  return clamp(pts, 0, cap)
}

function ma52Score(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.ma52
  let pts = 0
  const e20 = plan.levels?.ema20
  const e50 = plan.levels?.ema50
  if (e20 != null && e50 != null && e20 > e50) pts += 6
  const sl = slopeEma50(plan)
  if (sl != null && sl >= 0) pts += 4
  const last = lastPrice(plan)
  const high = plan.levels?.high52
  if (last != null && high != null && high > 0) {
    const gap = (high - last) / high
    if (gap >= 0 && gap <= 0.15) pts += 5
    else if (gap <= 0.25) pts += 3
    if (last < high * 0.75) pts = Math.min(pts, 6)
  }
  return clamp(pts, 0, cap)
}

function rrScore(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.rr
  const entry = triggerPrice(plan)
  const stop = plan.stopPrice
  const last = lastPrice(plan)
  if (entry == null || stop == null || last == null || entry <= stop) return 3
  const risk = entry - stop
  const high = plan.levels?.high52
  const pivot = plan.pivot
  const target = (pivot != null && pivot > entry)
    ? pivot
    : (high != null && high > entry ? high : entry + 2 * risk)
  const rr = (target - entry) / risk
  let pts = 2
  if (rr >= 2.5) pts = cap
  else if (rr >= 1.8) pts = 8
  else if (rr >= 1.2) pts = 6
  else if (rr >= 0.8) pts = 4
  const stopPct = stopPctOf(plan)
  if (stopPct != null && stopPct > 8) pts -= 4
  return clamp(pts, 0, cap)
}

function distanceScore(plan: PlanOfAttack): number {
  const cap = SCORE_WEIGHTS.distance
  const atrDist = atrToTrigger(plan)
  if (atrDist == null) return 4
  if (atrDist >= 0 && atrDist <= 0.8) return cap
  if (atrDist > 0.8 && atrDist <= 1.2) return 6
  if (atrDist < 0 && atrDist >= -0.2) return 6
  if (atrDist < -0.2 && atrDist >= -0.5) return 3
  if (atrDist > 1.2 && atrDist < 1.5) return 3
  return 2
}

export function qualityScore(plan: PlanOfAttack): number {
  const total =
    patternScore(plan)
    + volumeScore(plan)
    + rsStageScore(plan)
    + ma52Score(plan)
    + rrScore(plan)
    + distanceScore(plan)
  return clamp(Math.round(total), 0, 100)
}

function emptyTallies(): Record<RejectReason, number> {
  return {
    not_candidate: 0,
    not_near: 0,
    weekly_down: 0,
    earnings: 0,
    risk_missing: 0,
    cannot_size: 0,
    risk_vs_atr: 0,
    risk_vs_atr_high: 0,
    stop_too_wide_pct: 0,
    no_prior_thrust: 0,
    below_50: 0,
    flag_too_deep: 0,
    dead_tape: 0,
    illiquid_at_size: 0,
    no_trigger: 0,
    too_far_under: 0,
    chase_through: 0,
  }
}

function absDistance(plan: PlanOfAttack): number {
  return Math.abs(atrToTrigger(plan) ?? ((pctToTrigger(plan) ?? 99) / 2))
}

function sortFinalists(plans: PlanOfAttack[]): PlanOfAttack[] {
  return [...plans].sort((a, b) => {
    const scoreA = a.qualityScore ?? -1
    const scoreB = b.qualityScore ?? -1
    if (scoreA !== scoreB) return scoreB - scoreA
    const distA = absDistance(a)
    const distB = absDistance(b)
    if (distA !== distB) return distA - distB
    const advA = dollarAdvOf(a) ?? 0
    const advB = dollarAdvOf(b) ?? 0
    if (advA !== advB) return advB - advA
    return a.ticker.localeCompare(b.ticker)
  })
}

function withAccount(plan: PlanOfAttack, account: AccountSnapshot | null): PlanOfAttack {
  const sized = sizeFromAccount(account, plan.entryPrice, plan.stopPrice)
  const dollarAdv = dollarAdvOf(plan) ?? undefined
  const thrust = thrustFromPlan(plan, finalistConfig().priorThrustPct)
  const next: PlanOfAttack = {
    ...plan,
    dollarAdv,
    priorThrust60d: thrust?.rangePct ?? plan.priorThrust60d,
    stopPct: stopPctOf(plan) ?? undefined,
    stopAtrMultiple: stopAtrOf(plan) ?? undefined,
  }
  if (sized) {
    next.plannedSharesAtRoom = sized.plannedSharesAtRoom
    next.sizeableNow = sized.sizeableNow
  }
  return next
}

export function selectFinalists(
  plans: PlanOfAttack[],
  opts?: { account?: AccountSnapshot | null },
): FinalistResult {
  const cfg = finalistConfig()
  const account = opts && "account" in opts ? opts.account ?? null : null
  const tallies = emptyTallies()
  const warehouse: PlanOfAttack[] = []
  const kept: PlanOfAttack[] = []
  for (const raw of plans) {
    const plan = withAccount(raw, account)
    const reason = rejectReason(plan, cfg) ?? (plan.sizeableNow === false ? "cannot_size" as const : null)
    if (reason) {
      tallies[reason] += 1
      warehouse.push({ ...plan, failedGates: [reason] })
      continue
    }
    const scored = {
      ...plan,
      failedGates: [] as string[],
      qualityScore: qualityScore(plan),
    }
    warehouse.push(scored)
    kept.push(scored)
  }
  const familyLanded: FamilyCounts = { ma: 0, flag: 0, vcp: 0 }
  const mixCapped: FamilyCounts = { ma: 0, flag: 0, vcp: 0 }
  const finalists: PlanOfAttack[] = []
  for (const plan of sortFinalists(kept)) {
    const kind = setupKind(plan.setupType)
    if (cfg.maxPerFamily > 0 && kind !== "none" && familyLanded[kind] >= cfg.maxPerFamily) {
      mixCapped[kind] += 1
      plan.failedGates = ["mix_cap"]
      continue
    }
    if (cfg.maxNames > 0 && finalists.length >= cfg.maxNames) {
      plan.failedGates = ["dock_capped"]
      continue
    }
    finalists.push(plan)
    if (kind !== "none") familyLanded[kind] += 1
  }
  return {
    finalists,
    warehouse,
    rawCount: plans.length,
    tallies,
    familyLanded,
    mixCapped,
  }
}

export function tallyLine(result: FinalistResult): string {
  const dropped = REJECT_REASONS
    .filter((key) => result.tallies[key] > 0)
    .map((key) => `${REJECT_LABELS[key]} ${result.tallies[key]}`)
  const dropBit = dropped.length ? ` Dropped: ${dropped.join("; ")}.` : ""
  const mixSkipped = (result.mixCapped.ma + result.mixCapped.flag + result.mixCapped.vcp)
  const kept = result.rawCount - Object.values(result.tallies).reduce((a, b) => a + b, 0)
  const capped = kept - result.finalists.length
  const capBit = capped > 0 ? ` Capped off dock: ${capped}.` : ""
  const mixBits = (["ma", "flag", "vcp"] as const)
    .filter((key) => result.mixCapped[key] > 0)
    .map((key) => `${key === "ma" ? "MA" : key === "flag" ? "Flag" : "VCP"} ${result.mixCapped[key]}`)
  const mixBit = mixBits.length ? ` Mix cap ${mixBits.join(", ")}.` : ""
  const landed = result.familyLanded
  const mixNote = mixSkipped > 0 || result.finalists.length > 0
    ? ` Landed MA ${landed.ma}, Flag ${landed.flag}, VCP ${landed.vcp}.`
    : ""
  return `**Second pass:** ${result.rawCount} raw -> ${result.finalists.length} finalists.${dropBit}${capBit}${mixBit}${mixNote}`
}

export function mergeWarehouse(existing: PlanOfAttack[], incoming: PlanOfAttack[]): PlanOfAttack[] {
  const byTicker = new Map<string, PlanOfAttack>()
  const order: string[] = []
  for (const plan of existing) {
    if (!plan?.ticker) continue
    if (!byTicker.has(plan.ticker)) order.push(plan.ticker)
    byTicker.set(plan.ticker, plan)
  }
  for (const plan of incoming) {
    if (!plan?.ticker || plan.grade === "Pass") continue
    if (!byTicker.has(plan.ticker)) order.push(plan.ticker)
    byTicker.set(plan.ticker, plan)
  }
  return order.map((ticker) => byTicker.get(ticker)!).filter(Boolean)
}
