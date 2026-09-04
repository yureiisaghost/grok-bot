import fs from "node:fs"
import path from "node:path"
import type { DeskScanInfo, OhlcvBar, PlanOfAttack } from "../src/types"
import { ACTIVE_FILE, ARCHIVE_DIR, SCANS_DIR as QUEUE_DIR, ensureDeskDirs } from "./deskPaths"
import { mergeWarehouse } from "./finalists"
import { writeHandoff } from "./handoff"
import { nowPtStamp, todayPtIso } from "./http"
const DATE_FILE = /^(\d{4}-\d{2}-\d{2})(?:_scan-(\d+))?\.md$/i

const RECENT_BARS = 20
const SAFE_MD_CHARS = 900_000

interface ActiveScan {
  scanId: string
  day: string
  scan: number
  file: string
  json?: string
}

interface DockFile {
  scanId: string
  day: string
  scan: number
  generatedAt: string
  tallyLine: string
  keepers: PlanOfAttack[]
  /** @deprecated same as Candidate keepers — old Desk readers */
  finalists: PlanOfAttack[]
}

function scanStem(day: string, scan: number) {
  return scan <= 1 ? day : `${day}_scan-${scan}`
}

function jsonNameFor(day: string, scan: number) {
  return `${scanStem(day, scan)}.json`
}

function jsonSibling(mdName: string) {
  return mdName.replace(/\.md$/i, ".json")
}

function warehousePaths(day: string, scan: number) {
  const stem = scanStem(day, scan)
  return {
    rawMd: path.join(ARCHIVE_DIR, `${stem}_raw.md`),
    rawJson: path.join(ARCHIVE_DIR, `${stem}_raw.json`),
  }
}

function headerFor(day: string, scan: number, kind: "warehouse" | "keepers", stamp = nowPtStamp()) {
  const title = scan <= 1 ? `# ${day}` : `# ${day} · Scan ${scan}`
  const purpose = kind === "warehouse"
    ? "**Purpose:** First-pass warehouse. Every Candidate and Developing from this scan. Pass never writes. Phone Grok filters against the live Robinhood book."
    : "**Purpose:** Full keeper list for Phone Grok. Candidate + Developing. No dock trim. Phone live-quotes this list, fits leftover cash, and asks Yurei."
  return `${title}
**Session started:** ${stamp}
${purpose}

---
`
}

function fileNameFor(day: string, scan: number) {
  return scan <= 1 ? `${day}.md` : `${day}_scan-${scan}.md`
}

function parseScanName(name: string) {
  const match = name.match(DATE_FILE)
  if (!match) return null
  return { day: match[1], scan: match[2] ? Number(match[2]) : 1 }
}

function ensureDirs() {
  ensureDeskDirs()
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a"
  return `$${n.toFixed(2)}`
}

function px(n: number) {
  return n.toFixed(2)
}

function formatVol(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "—"
  if (n >= 1_000_000) {
    const m = n / 1_000_000
    return `${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`.replace(/\.0+M$/, "M")
  }
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(Math.round(n))
}

function keySwings(bars: OhlcvBar[], ema20: number | null) {
  if (bars.length < 5) return null
  let impulseIdx = 0
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].high > bars[impulseIdx].high) impulseIdx = i
  }
  let probeIdx = impulseIdx
  for (let i = impulseIdx; i < bars.length; i++) {
    if (bars[i].low < bars[probeIdx].low) probeIdx = i
  }
  let reclaimClose: number | null = null
  for (let i = probeIdx + 1; i < bars.length; i++) {
    const bar = bars[i]
    const closeAboveEma = ema20 === null || bar.close > ema20
    if (bar.close > bar.open && closeAboveEma && bar.close > bars[probeIdx].high) {
      reclaimClose = bar.close
      break
    }
  }
  return {
    impulseHigh: bars[impulseIdx].high,
    probeLow: bars[probeIdx].low,
    reclaimClose,
  }
}

function recentDailyBlock(plan: PlanOfAttack, barLimit = RECENT_BARS) {
  const bars = (plan.chart ?? []).slice(-Math.max(barLimit, RECENT_BARS))
  if (!bars.length) return ""
  const rows = bars.map((bar) => {
    const date = bar.time.slice(0, 10)
    return `| ${date} | ${px(bar.open)} | ${px(bar.high)} | ${px(bar.low)} | ${px(bar.close)} | ${formatVol(bar.volume)} |`
  })
  const swings = keySwings(bars, plan.levels.ema20)
  const swingLine = swings
    ? `**Key swings:** impulse high ${px(swings.impulseHigh)} · probe low ${px(swings.probeLow)} · reclaim close ${swings.reclaimClose === null ? "none yet" : px(swings.reclaimClose)}`
    : ""
  return `### Recent Daily (last ${bars.length})
| Date | O | H | L | C | Vol |
|------|-----|-----|-----|-----|------|
${rows.join("\n")}
${swingLine}
`
}

function atrToTrigger(plan: PlanOfAttack) {
  const atr = plan.geometry?.atrToLevel
  if (atr === null || atr === undefined || !Number.isFinite(atr)) return "n/a"
  if (Math.abs(atr) < 0.05) return "at trigger"
  return `${Math.abs(atr).toFixed(1)} ATR ${atr > 0 ? "under" : "above"} trigger`
}

function earnDaysLabel(days: number | null | undefined) {
  if (days === null || days === undefined) return "none"
  return String(days)
}

function blockFor(plan: PlanOfAttack, barLimit = RECENT_BARS) {
  const warn = plan.warnings.length
    ? plan.warnings.map((w) => `- ${w}`).join("\n")
    : "- None"
  const risk = plan.oneShareRisk ?? plan.sizing.dollarRisk
  const quality = plan.qualityScore == null ? "n/a" : String(plan.qualityScore)
  const stopPct = plan.stopPct == null ? "n/a" : `${plan.stopPct.toFixed(1)}%`
  const stopAtr = plan.stopAtrMultiple == null ? "n/a" : `${plan.stopAtrMultiple.toFixed(2)}x`
  const thrust = plan.priorThrust60d == null ? "n/a" : `${plan.priorThrust60d.toFixed(1)}%`
  const retrace = plan.flagRetracePct != null ? `- **Flag retrace:** ${plan.flagRetracePct.toFixed(0)}%\n` : ""
  const gates = plan.failedGates && plan.failedGates.length ? `- **Failed gates:** ${plan.failedGates.join(", ")}\n` : ""
  return `## ${plan.ticker} — ${plan.grade}
- **CA grade:** ${plan.grade}
- **Readiness:** ${plan.readiness}
- **Family:** ${plan.setupType}
- **Quality score:** ${quality}
- **Stop %:** ${stopPct}
- **Stop ATR:** ${stopAtr}
- **Prior thrust 60d:** ${thrust}
${retrace}${gates}- **1-share risk:** ${money(risk)}
- **ATR to trigger:** ${atrToTrigger(plan)}
- **Avg volume:** ${plan.levels.avgVolume == null ? "n/a" : formatVol(plan.levels.avgVolume)}
- **Earnings days:** ${earnDaysLabel(plan.earnDays)}
- **Name:** ${plan.name}
- **Setup Type:** ${plan.setupType}
- **Last Price:** ${money(plan.lastPrice)} (${plan.changePct >= 0 ? "+" : ""}${plan.changePct.toFixed(2)}%)
- **Weekly Trend:** ${plan.weeklyTrend}
- **Entry Method:** ${plan.entryMethod}
- **Entry Trigger:** ${plan.entryTrigger}
- **Invalidation:** ${plan.invalidation}
- **Stop:** ${plan.stop}
- **Ticket:** Entry ${money(plan.entryPrice)} · Stop ${money(plan.stopPrice)} · Pivot ${money(plan.pivot)} · R1 ${money(plan.r1)} · R2 ${money(plan.r2)} · R3 ${money(plan.r3)}
- **Chart read:** ${plan.geometry?.caption ?? "n/a"}
- **Original Thesis:** ${plan.thesis}
- **Plan:** ${plan.plan}
- **Earnings:** ${plan.earnings}
- **Levels:** 20 EMA ${money(plan.levels.ema20)} · 50 EMA ${money(plan.levels.ema50)} · RSI(14) ${plan.levels.rsi14?.toFixed(1) ?? "n/a"} · ATR(14) ${plan.levels.atr14 ? plan.levels.atr14.toFixed(2) : "n/a"} · Rel vol ${plan.levels.relativeVolume == null ? "n/a" : `${plan.levels.relativeVolume.toFixed(2)}x`} · 52w ${money(plan.levels.low52)}–${money(plan.levels.high52)}
- **Warnings:**
${warn}
- **Saved:** ${nowPtStamp()}
- **Source:** Bot scan / Robinhood daily bars

${recentDailyBlock(plan, barLimit)}`
}

function splitSections(text: string) {
  const headerMatch = text.split(/^## /m)
  const header = headerMatch[0] ?? ""
  const sections = headerMatch.slice(1).map((s) => `## ${s}`.trimEnd() + "\n")
  return { header, sections }
}

function tickerFromSection(section: string) {
  const m = section.match(/^##\s+([A-Z0-9.]+)\s+—/)
  return m?.[1] ?? null
}

export function queueMeta() {
  ensureDirs()
  const active = readActive()
  if (active) {
    const filePath = path.join(QUEUE_DIR, active.file)
    if (fs.existsSync(filePath)) return metaFor(filePath)
  }
  const files = workingPaths()
  if (files.length === 1) return metaFor(files[0])
  return metaFor(null)
}

function keeperTally(plans: PlanOfAttack[]) {
  const candidate = plans.filter((plan) => plan.grade === "Candidate").length
  const developing = plans.filter((plan) => plan.grade === "Developing").length
  return `**Keepers:** ${candidate} Candidate · ${developing} Developing. Phone Grok is the final filter against the live book. Pass never writes.`
}

function sortKeepers(plans: PlanOfAttack[]) {
  return [...plans].sort((a, b) => {
    const rank = (plan: PlanOfAttack) => (plan.grade === "Candidate" ? 0 : 1)
    return rank(a) - rank(b) || b.score - a.score || a.ticker.localeCompare(b.ticker)
  })
}

function slimKeeper(plan: PlanOfAttack) {
  return {
    ticker: plan.ticker,
    name: plan.name,
    grade: plan.grade,
    score: plan.score,
    setupType: plan.setupType,
    lastPrice: plan.lastPrice,
    readiness: plan.readiness,
    entryMethod: plan.entryMethod,
    entryTrigger: plan.entryTrigger,
    invalidation: plan.invalidation,
    stop: plan.stop,
    thesis: plan.thesis,
    plan: plan.plan,
    earnings: plan.earnings,
    warnings: plan.warnings,
    entryPrice: plan.entryPrice,
    stopPrice: plan.stopPrice,
    r1: plan.r1,
    r2: plan.r2,
    r3: plan.r3,
    oneShareRisk: plan.oneShareRisk,
    earnDays: plan.earnDays,
    qualityScore: plan.qualityScore ?? null,
    failedGates: plan.failedGates ?? [],
  }
}

function composeMarkdown(
  day: string,
  scan: number,
  kind: "warehouse" | "keepers",
  plans: PlanOfAttack[],
  barLimit = RECENT_BARS,
) {
  const header = headerFor(day, scan, kind)
  const tally = keeperTally(plans)
  if (!plans.length) {
    return `${header}
**Keepers:** 0

No Candidate or Developing names on this scan.

${tally}
`.replace(/\n{3,}/g, "\n\n")
  }
  const body = plans.map((plan) => blockFor(plan, barLimit)).join("\n")
  return `${header}\n${body}\n---\n${tally}\n`.replace(/\n{3,}/g, "\n\n")
}

function readWarehouse(rawJson: string): PlanOfAttack[] {
  try {
    if (!fs.existsSync(rawJson)) return []
    const data = JSON.parse(fs.readFileSync(rawJson, "utf8")) as PlanOfAttack[]
    return Array.isArray(data) ? data.filter((plan) => plan?.ticker) : []
  } catch {
    return []
  }
}

function snapshotFatWorkingFile(workingPath: string, day: string, scan: number, hasJson: boolean) {
  if (hasJson || !fs.existsSync(workingPath)) return
  const text = fs.readFileSync(workingPath, "utf8")
  if (!hasTickerBlocks(text) || /second-pass finalist/i.test(text)) return
  const dest = uniqueArchivePath(`${scanStem(day, scan)}_pre-finalist.md`)
  fs.copyFileSync(workingPath, dest)
}

export function savePlan(plan: PlanOfAttack, scanId?: string) {
  return savePlans([plan], scanId)
}

export function savePlans(plans: PlanOfAttack[], scanId = "default") {
  const incoming = plans.filter((plan) => plan?.ticker && plan.grade && plan.grade !== "Pass")
  const { filePath, day, scan } = openScan(scanId)
  const { rawMd, rawJson } = warehousePaths(day, scan)
  snapshotFatWorkingFile(filePath, day, scan, fs.existsSync(rawJson))
  const merged = sortKeepers(mergeWarehouse(readWarehouse(rawJson), incoming))
  ensureDirs()
  fs.writeFileSync(rawJson, JSON.stringify(merged), "utf8")
  fs.writeFileSync(rawMd, composeMarkdown(day, scan, "warehouse", merged), "utf8")
  const jsonName = jsonNameFor(day, scan)
  const jsonPath = path.join(QUEUE_DIR, jsonName)
  const candidates = merged.filter((plan) => plan.grade === "Candidate")
  const developing = merged.filter((plan) => plan.grade === "Developing")
  const tallyLine = keeperTally(merged)
  const dock: DockFile = {
    scanId,
    day,
    scan,
    generatedAt: nowPtStamp(),
    tallyLine,
    keepers: merged,
    finalists: candidates,
  }
  fs.writeFileSync(jsonPath, JSON.stringify(dock), "utf8")
  const stem = scanStem(day, scan)
  const slim = {
    day,
    scan,
    generatedAt: nowPtStamp(),
    candidateCount: candidates.length,
    developingCount: developing.length,
    candidates: candidates.map(slimKeeper),
    developing: developing.map(slimKeeper),
  }
  fs.writeFileSync(path.join(QUEUE_DIR, `${stem}_keepers.json`), JSON.stringify(slim, null, 2), "utf8")
  fs.writeFileSync(path.join(QUEUE_DIR, `${stem}_candidates.json`), JSON.stringify(slim, null, 2), "utf8")
  let md = composeMarkdown(day, scan, "keepers", merged)
  if (md.length > SAFE_MD_CHARS) {
    md = composeMarkdown(day, scan, "keepers", merged, 10)
  }
  fs.writeFileSync(filePath, md, "utf8")
  writeActive({ scanId, day, scan, file: path.basename(filePath), json: jsonName })
  writeHandoff("save")
  return metaFor(filePath, merged.length, merged.length)
}

function workingNames() {
  ensureDirs()
  return fs.readdirSync(QUEUE_DIR).filter((name) => name.toLowerCase().endsWith(".md"))
}

function workingPaths() {
  return workingNames().map((name) => path.join(QUEUE_DIR, name))
}

function readActive(): ActiveScan | null {
  try {
    if (!fs.existsSync(ACTIVE_FILE)) return null
    const data = JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")) as ActiveScan
    if (!data?.scanId || !data.day || !data.file) return null
    return {
      ...data,
      json: data.json ?? jsonSibling(data.file),
    }
  } catch {
    return null
  }
}

function writeActive(active: ActiveScan) {
  ensureDirs()
  fs.writeFileSync(ACTIVE_FILE, JSON.stringify(active, null, 2), "utf8")
}

function clearActive() {
  if (fs.existsSync(ACTIVE_FILE)) fs.unlinkSync(ACTIVE_FILE)
}

function uniqueArchivePath(basename: string) {
  const dest = path.join(ARCHIVE_DIR, basename)
  if (!fs.existsSync(dest)) return dest
  const parsed = path.parse(basename)
  let n = 2
  while (fs.existsSync(path.join(ARCHIVE_DIR, `${parsed.name}_${n}${parsed.ext}`))) n += 1
  return path.join(ARCHIVE_DIR, `${parsed.name}_${n}${parsed.ext}`)
}

function archivePath(filePath: string) {
  ensureDirs()
  let basename = path.basename(filePath)
  if (basename.toLowerCase() === "potential_trades.md") {
    const day = todayPtIso()
    const scan = Math.max(1, maxScanForDay(day))
    basename = fileNameFor(day, scan === 0 ? 1 : scan)
    if (fs.existsSync(path.join(ARCHIVE_DIR, basename)) || workingNames().includes(basename)) {
      basename = fileNameFor(day, nextScan(day))
    }
  }
  const dest = uniqueArchivePath(basename)
  fs.renameSync(filePath, dest)
  const jsonSrc = path.join(path.dirname(filePath), jsonSibling(path.basename(filePath)))
  if (fs.existsSync(jsonSrc)) {
    const jsonDest = uniqueArchivePath(jsonSibling(path.basename(dest)))
    fs.renameSync(jsonSrc, jsonDest)
  }
  return dest
}

function archiveWorkingFiles() {
  const archived: string[] = []
  for (const filePath of workingPaths()) {
    const text = fs.readFileSync(filePath, "utf8")
    if (!hasTickerBlocks(text)) {
      fs.unlinkSync(filePath)
      const jsonSrc = path.join(path.dirname(filePath), jsonSibling(path.basename(filePath)))
      if (fs.existsSync(jsonSrc)) fs.unlinkSync(jsonSrc)
      continue
    }
    archived.push(archivePath(filePath))
  }
  return archived
}

function maxScanForDay(day: string) {
  let max = 0
  for (const dir of [QUEUE_DIR, ARCHIVE_DIR]) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const parsed = parseScanName(name)
      if (parsed?.day === day && parsed.scan > max) max = parsed.scan
    }
  }
  return max
}

function nextScan(day: string) {
  return maxScanForDay(day) + 1
}

function metaFor(filePath: string | null, rawCount?: number, finalistCount?: number) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      path: QUEUE_DIR,
      fileName: null as string | null,
      scan: null as number | null,
      day: null as string | null,
      tickerCount: 0,
      tickers: [] as string[],
      updatedAt: null as string | null,
      rawCount: rawCount ?? null,
      finalistCount: finalistCount ?? 0,
    }
  }
  const text = fs.readFileSync(filePath, "utf8")
  const { sections } = splitSections(text)
  const tickers = sections.map(tickerFromSection).filter((t): t is string => Boolean(t))
  const name = path.basename(filePath)
  const parsed = parseScanName(name)
  const stat = fs.statSync(filePath)
  let raw = rawCount ?? null
  if (raw == null && parsed) {
    const json = warehousePaths(parsed.day, parsed.scan).rawJson
    raw = readWarehouse(json).length
  }
  return {
    path: filePath,
    fileName: name,
    scan: parsed?.scan ?? null,
    day: parsed?.day ?? null,
    tickerCount: tickers.length,
    tickers,
    updatedAt: stat.mtime.toISOString(),
    rawCount: raw,
    finalistCount: finalistCount ?? tickers.length,
  }
}

function openScan(scanId: string) {
  ensureDirs()
  const day = todayPtIso()
  const active = readActive()
  if (active && active.scanId === scanId && active.day === day) {
    const filePath = path.join(QUEUE_DIR, active.file)
    return { filePath, day, scan: active.scan }
  }

  const existing = workingPaths()
  const adopt = !active && existing.length === 1
  if (adopt) {
    const currentPath = existing[0]
    const currentName = path.basename(currentPath)
    const parsed = parseScanName(currentName)
    if (!parsed || parsed.day === day) {
      const scan = parsed?.day === day ? parsed.scan : nextScan(day)
      const want = fileNameFor(day, scan)
      const filePath = path.join(QUEUE_DIR, want)
      if (currentName !== want) {
        if (fs.existsSync(filePath) && filePath !== currentPath) archivePath(filePath)
        fs.renameSync(currentPath, filePath)
      }
      writeActive({ scanId, day, scan, file: want, json: jsonNameFor(day, scan) })
      return { filePath, day, scan }
    }
  }

  archiveWorkingFiles()
  const scan = nextScan(day)
  const want = fileNameFor(day, scan)
  const filePath = path.join(QUEUE_DIR, want)
  writeActive({ scanId, day, scan, file: want, json: jsonNameFor(day, scan) })
  return { filePath, day, scan }
}

function hasTickerBlocks(text: string) {
  return /^##\s+[A-Z0-9.]+\s+—/m.test(text)
}

export function clearQueue() {
  ensureDirs()
  const archived = archiveWorkingFiles()
  clearActive()
  writeHandoff("save")
  return { archivedTo: archived[archived.length - 1] ?? null, tickerCount: 0 }
}

function readDock(jsonPath: string): PlanOfAttack[] {
  try {
    if (!fs.existsSync(jsonPath)) return []
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as DockFile | PlanOfAttack[]
    if (Array.isArray(data)) return data.filter((plan) => plan?.ticker)
    if (Array.isArray(data.keepers)) return data.keepers.filter((plan) => plan?.ticker)
    return Array.isArray(data.finalists) ? data.finalists.filter((plan) => plan?.ticker) : []
  } catch {
    return []
  }
}

export function loadDeskUniverse(): {
  plans: PlanOfAttack[]
  warehouse: PlanOfAttack[]
  finalists: PlanOfAttack[]
  meta: DeskScanInfo
} {
  ensureDirs()
  const active = readActive()
  const working = workingPaths()
  const filePath = active
    ? path.join(QUEUE_DIR, active.file)
    : working[0] ?? null
  const metaBase = metaFor(filePath && fs.existsSync(filePath) ? filePath : null)
  const parsed = metaBase.fileName ? parseScanName(metaBase.fileName) : null
  const warehouse = parsed ? readWarehouse(warehousePaths(parsed.day, parsed.scan).rawJson) : []
  const jsonName = active?.json ?? (metaBase.fileName ? jsonSibling(metaBase.fileName) : null)
  const jsonPath = jsonName ? path.join(QUEUE_DIR, jsonName) : null
  const finalists = jsonPath ? readDock(jsonPath) : []
  const plans = warehouse.length ? warehouse : finalists
  const signature = filePath && fs.existsSync(filePath)
    ? `${path.basename(filePath)}:${fs.statSync(filePath).mtimeMs}`
    : jsonPath && fs.existsSync(jsonPath)
      ? `${path.basename(jsonPath)}:${fs.statSync(jsonPath).mtimeMs}`
      : null
  return {
    plans,
    warehouse,
    finalists,
    meta: {
      fileName: metaBase.fileName,
      day: metaBase.day,
      scan: metaBase.scan,
      scanId: active?.scanId ?? null,
      keeperCount: warehouse.length || metaBase.rawCount || plans.length,
      finalistCount: finalists.length || metaBase.finalistCount || 0,
      updatedAt: metaBase.updatedAt,
      signature,
    },
  }
}
