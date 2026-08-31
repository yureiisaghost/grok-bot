import type { Grade, PlanOfAttack, ScanRow } from "../types"
import { isKeeper } from "./batch"

export function queuedRow(input: Omit<ScanRow, "status" | "grade" | "score" | "setupType" | "failReason">): ScanRow {
  return {
    ...input,
    status: "queued",
    grade: null,
    score: null,
    setupType: null,
    failReason: null,
  }
}

export function rowsFromTickers(tickers: string[], source: string): ScanRow[] {
  const seen = new Set<string>()
  const rows: ScanRow[] = []
  for (const raw of tickers) {
    const ticker = raw.trim().toUpperCase().replace(/^\$/, "")
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    rows.push(queuedRow({
      ticker,
      name: null,
      price: null,
      change1d: null,
      perf1w: null,
      perf1m: null,
      vol1w: null,
      vol1m: null,
      source,
    }))
  }
  return rows
}

export function mergeScanRows(current: ScanRow[], incoming: ScanRow[]): ScanRow[] {
  if (!current.length) return incoming
  const byTicker = new Map(current.map((row) => [row.ticker, row]))
  const order = current.map((row) => row.ticker)
  for (const row of incoming) {
    const prev = byTicker.get(row.ticker)
    if (prev) {
      const price = row.price ?? prev.price
      const merged: ScanRow = {
        ...prev,
        name: row.name ?? prev.name,
        price,
        change1d: row.change1d ?? prev.change1d,
        perf1w: row.perf1w ?? prev.perf1w,
        perf1m: row.perf1m ?? prev.perf1m,
        vol1w: row.vol1w ?? prev.vol1w,
        vol1m: row.vol1m ?? prev.vol1m,
        source: row.source || prev.source,
      }
      if (prev.status === "skipped" && !isCheapCsvPrice(merged)) {
        byTicker.set(row.ticker, queuedRow({
          ticker: merged.ticker,
          name: merged.name,
          price: merged.price,
          change1d: merged.change1d,
          perf1w: merged.perf1w,
          perf1m: merged.perf1m,
          vol1w: merged.vol1w,
          vol1m: merged.vol1m,
          source: merged.source,
        }))
      } else {
        byTicker.set(row.ticker, merged)
      }
    } else {
      byTicker.set(row.ticker, row)
      order.push(row.ticker)
    }
  }
  return order.map((ticker) => byTicker.get(ticker)!)
}

export function patchRow(rows: ScanRow[], ticker: string, patch: Partial<ScanRow>): ScanRow[] {
  return rows.map((row) => (row.ticker === ticker ? { ...row, ...patch } : row))
}

export function applyPlanToRow(row: ScanRow, plan: PlanOfAttack): ScanRow {
  const passGate = plan.grade === "Pass"
    ? (plan.warnings[0] || plan.thesis.split(/(?<=\.)\s/)[0] || plan.thesis || "Pass")
    : null
  return {
    ...row,
    name: plan.name || row.name,
    status: "graded",
    grade: plan.grade,
    score: plan.score,
    setupType: plan.setupType,
    failReason: passGate,
  }
}

export function failRow(row: ScanRow, reason: string): ScanRow {
  return {
    ...row,
    status: "failed",
    grade: null,
    score: null,
    setupType: null,
    failReason: reason,
  }
}

/** CSV price column present and under $5. Do not invent a skip when price is missing. */
export function isCheapCsvPrice(row: ScanRow) {
  return row.price != null && Number.isFinite(row.price) && row.price > 0 && row.price < 5
}

export function skipRow(row: ScanRow, reason: string): ScanRow {
  return {
    ...row,
    status: "skipped",
    grade: null,
    score: null,
    setupType: null,
    failReason: reason,
  }
}

export function pendingTickers(rows: ScanRow[], plans?: Record<string, PlanOfAttack>) {
  return rows.filter((row) => {
    if (row.status === "skipped") return false
    if (row.status === "queued" || row.status === "failed") return true
    if (plans && row.status === "graded" && !plans[row.ticker]) return true
    return false
  }).map((row) => row.ticker)
}

export function tickerWithPlan(plans: Record<string, PlanOfAttack>, preferred?: string | null) {
  if (preferred && plans[preferred]) return preferred
  const keepers = Object.values(plans).filter(isKeeper)
  if (keepers.length) {
    const ranked = [...keepers].sort((a, b) => (
      (a.grade === "Candidate" ? 0 : 1) - (b.grade === "Candidate" ? 0 : 1)
      || b.score - a.score
      || a.ticker.localeCompare(b.ticker)
    ))
    return ranked[0].ticker
  }
  const all = Object.values(plans)
  return all[all.length - 1]?.ticker ?? null
}

export function migrateGrade(grade: string | null | undefined): Grade | null {
  if (!grade) return null
  if (grade === "Live" || grade === "Candidate") return "Candidate"
  if (grade === "Early Watch" || grade === "Developing") return "Developing"
  if (grade === "Pass") return "Pass"
  return null
}

export function migratePlan(plan: PlanOfAttack): PlanOfAttack {
  const grade = migrateGrade(plan.grade) ?? "Pass"
  const oneShareRisk = plan.oneShareRisk ?? (
    plan.entryPrice != null && plan.stopPrice != null && plan.entryPrice > plan.stopPrice
      ? plan.entryPrice - plan.stopPrice
      : null
  )
  const readiness = plan.readiness ?? (
    grade === "Pass" ? "none" : grade === "Developing" ? "forming" : grade === "Candidate" ? "near" : "none"
  )
  return {
    ...plan,
    grade,
    oneShareRisk,
    earnDays: plan.earnDays ?? null,
    readiness,
  }
}

export function scanCounts(rows: ScanRow[], plans?: Record<string, PlanOfAttack>) {
  let queued = 0
  let running = 0
  let candidate = 0
  let developing = 0
  let pass = 0
  let failed = 0
  let skipped = 0
  let missingPlans = 0
  for (const row of rows) {
    if (row.status === "queued") queued += 1
    else if (row.status === "running") running += 1
    else if (row.status === "failed") failed += 1
    else if (row.status === "skipped") skipped += 1
    else if (row.grade === "Candidate") candidate += 1
    else if (row.grade === "Developing") developing += 1
    else if (row.grade === "Pass") pass += 1
    if (plans && row.status === "graded" && !plans[row.ticker]) missingPlans += 1
  }
  return {
    total: rows.length,
    queued,
    running,
    candidate,
    developing,
    pass,
    failed,
    skipped,
    missingPlans,
    keepers: candidate + developing,
    pending: queued + failed + missingPlans,
  }
}

export function recordFromPlans(plans: PlanOfAttack[]) {
  const record: Record<string, PlanOfAttack> = {}
  for (const plan of plans) record[plan.ticker] = plan
  return record
}

export function keeperPlans(plans: Record<string, PlanOfAttack>) {
  return Object.values(plans).filter(isKeeper)
}
