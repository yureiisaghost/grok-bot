import "./loadLocalEnv"
import fs from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { buildPlan } from "./analyze"
import { rowsFromCsvText, isCheapCsvPrice } from "./csv"
import { SCAN_PROGRESS_FILE, SCANS_DIR, SCREENER_UPLOADS_DIR, ensureDeskDirs, posixRel } from "./deskPaths"
import { savePlans } from "./markdown"
import { DataError } from "./market"
import { mintFromActiveScan } from "./outcomes"
import { NeedsAuthError, fetchMarketPack } from "./rhMcp"
import { DEFAULT_WAIT_MS, maintainScreenerFolder, tidyScreenerFolderOnSkip, waitForNewCsv } from "./screenerCsv"
import { ensureWatchesFile, writeTapeCard } from "./tape"
import type { PlanOfAttack } from "../src/types"

interface Progress {
  scanId: string
  csvPath: string
  graded: Record<string, PlanOfAttack>
  skipped: string[]
  failed: Array<{ ticker: string; error: string }>
}

function parseArgs(argv: string[]) {
  let csvPath = ""
  let resume = false
  let waitMinutes: number | null = null
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--resume") resume = true
    else if (arg === "--csv") {
      csvPath = argv[i + 1] ?? ""
      i += 1
    } else if (arg.startsWith("--csv=")) csvPath = arg.slice(6)
    else if (arg === "--wait-minutes") {
      waitMinutes = Number(argv[i + 1] ?? "")
      i += 1
    } else if (arg.startsWith("--wait-minutes=")) waitMinutes = Number(arg.slice(15))
    else if (!arg.startsWith("-") && !csvPath) csvPath = arg
  }
  return { csvPath: csvPath.trim(), resume, waitMinutes }
}

function loadProgress(): Progress | null {
  try {
    if (!fs.existsSync(SCAN_PROGRESS_FILE)) return null
    return JSON.parse(fs.readFileSync(SCAN_PROGRESS_FILE, "utf8")) as Progress
  } catch {
    return null
  }
}

function writeProgress(progress: Progress) {
  ensureDeskDirs()
  fs.writeFileSync(SCAN_PROGRESS_FILE, JSON.stringify(progress), "utf8")
}

function clearProgress() {
  if (fs.existsSync(SCAN_PROGRESS_FILE)) fs.unlinkSync(SCAN_PROGRESS_FILE)
}

async function gradeOne(ticker: string): Promise<PlanOfAttack> {
  const pack = await fetchMarketPack(ticker)
  return buildPlan(pack)
}

async function main() {
  const { csvPath, resume, waitMinutes } = parseArgs(process.argv.slice(2))
  ensureDeskDirs()

  let absCsv = ""
  let fromUploadsDrop = false
  if (csvPath) {
    absCsv = path.resolve(csvPath)
    if (!fs.existsSync(absCsv)) {
      console.error(`CSV not found: ${absCsv}`)
      process.exit(1)
    }
  } else {
    const waitMs = typeof waitMinutes === "number" && Number.isFinite(waitMinutes)
      ? Math.max(0, waitMinutes) * 60_000
      : DEFAULT_WAIT_MS
    const found = await waitForNewCsv(SCREENER_UPLOADS_DIR, {
      waitMs,
      log: (line) => console.log(line),
    })
    if (!found) {
      const archived = tidyScreenerFolderOnSkip(SCREENER_UPLOADS_DIR)
      if (archived.length) console.log(`[scan] archived ${archived.length} extra screener file(s) to Screener Uploads/Archive/`)
      console.log("[scan] no new screener in Screener Uploads/. Skip.")
      process.exit(0)
    }
    absCsv = found.abs
    fromUploadsDrop = true
    console.log(`[scan] new screener ${posixRel(absCsv)}`)
  }

  const rows = rowsFromCsvText(fs.readFileSync(absCsv, "utf8"))
  if (!rows.length) {
    console.error("No Symbol/Ticker column tickers found. Export the TradingView screener as CSV.")
    process.exit(1)
  }

  const existing = resume ? loadProgress() : null
  const progress: Progress = existing && existing.csvPath === absCsv
    ? existing
    : { scanId: randomUUID(), csvPath: absCsv, graded: {}, skipped: [], failed: [] }

  const todo: string[] = []
  for (const row of rows) {
    if (isCheapCsvPrice(row)) {
      if (!progress.skipped.includes(row.ticker)) progress.skipped.push(row.ticker)
      continue
    }
    if (progress.graded[row.ticker]) continue
    todo.push(row.ticker)
  }

  console.log(`[scan] ${rows.length} names in CSV. Skip ${progress.skipped.length} under $5. Grade ${todo.length}${resume ? " (resume)" : ""}.`)

  const started = Date.now()
  for (let i = 0; i < todo.length; i++) {
    const ticker = todo[i]
    const at = Date.now()
    try {
      const plan = await gradeOne(ticker)
      progress.graded[ticker] = plan
      progress.failed = progress.failed.filter((row) => row.ticker !== ticker)
      console.log(`[scan] ${i + 1}/${todo.length} ${ticker} ${plan.grade} ${Date.now() - at}ms`)
    } catch (err) {
      if (err instanceof NeedsAuthError) {
        writeProgress(progress)
        console.error("Robinhood MCP is not connected. Run: npm run rh:connect")
        if (err.authUrl) console.error(err.authUrl)
        process.exit(2)
      }
      const message = err instanceof DataError ? err.message : err instanceof Error ? err.message : String(err)
      progress.failed = progress.failed.filter((row) => row.ticker !== ticker)
      progress.failed.push({ ticker, error: message })
      console.warn(`[scan] ${i + 1}/${todo.length} ${ticker} FAIL ${Date.now() - at}ms ${message}`)
    }
    writeProgress(progress)
  }

  const keepers = Object.values(progress.graded).filter((plan) => plan.grade === "Candidate" || plan.grade === "Developing")
  const pass = Object.values(progress.graded).filter((plan) => plan.grade === "Pass").length
  const candidate = keepers.filter((plan) => plan.grade === "Candidate").length
  const developing = keepers.filter((plan) => plan.grade === "Developing").length

  const meta = keepers.length
    ? savePlans(keepers, progress.scanId)
    : savePlans([], progress.scanId)

  try {
    mintFromActiveScan()
  } catch (err) {
    console.warn(`[scan] outcome mint failed (${err instanceof Error ? err.message : String(err)})`)
  }

  let tapeNote = "tape skipped"
  try {
    const tape = await writeTapeCard()
    tapeNote = `QQQ last ${tape.qqqLast ?? "n/a"} stacked ${tape.stacked}`
  } catch (err) {
    console.warn(`[scan] tape card failed (${err instanceof Error ? err.message : String(err)})`)
  }
  ensureWatchesFile()

  const stem = meta.fileName ? meta.fileName.replace(/\.md$/i, "") : null
  const uploads = [
    meta.fileName ? `desk-data/scans/${meta.fileName}` : null,
    stem ? `desk-data/scans/${stem}.json` : null,
    stem ? `desk-data/scans/${stem}_keepers.json` : null,
    stem ? `desk-data/scans/${stem}_candidates.json` : null,
    "desk-data/scans/.active-scan.json",
    "desk-data/scans/outcomes/",
    "desk-data/regime.json",
    "desk-data/watches.json",
  ].filter(Boolean)

  const summary = {
    csv: absCsv,
    elapsedMs: Date.now() - started,
    csvRows: rows.length,
    skippedUnder5: progress.skipped.length,
    graded: Object.keys(progress.graded).length,
    candidate,
    developing,
    pass,
    failed: progress.failed,
    tape: tapeNote,
    scanFile: meta.fileName,
    uploads,
  }

  ensureDeskDirs()
  if (stem) {
    fs.writeFileSync(path.join(SCANS_DIR, `${stem}_bot-summary.json`), JSON.stringify(summary, null, 2), "utf8")
  }

  console.log("")
  console.log(`[scan] done in ${Math.round(summary.elapsedMs / 1000)}s`)
  console.log(`[scan] ${candidate} Candidate · ${developing} Developing · ${pass} Pass · ${progress.skipped.length} skipped <$5 · ${progress.failed.length} failed`)
  if (progress.failed.length) {
    console.log("[scan] failed:", progress.failed.map((row) => `${row.ticker}: ${row.error}`).join(" · "))
  }
  console.log(`[scan] ${tapeNote}`)
  console.log("[scan] upload to Drive Grok Trading/:")
  for (const file of uploads) console.log(`  ${file}`)
  console.log("[scan] Phone Grok reads the full keeper .md. Do not trim. Do not Place Order.")

  const uploadsRoot = path.resolve(SCREENER_UPLOADS_DIR)
  const scanned = path.resolve(absCsv)
  if (fromUploadsDrop || scanned === uploadsRoot || scanned.startsWith(uploadsRoot + path.sep)) {
    const { archived } = maintainScreenerFolder(SCREENER_UPLOADS_DIR, absCsv)
    if (archived.length) {
      console.log(`[scan] archived ${archived.length} old screener(s) to Screener Uploads/Archive/`)
    }
  }

  clearProgress()
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
