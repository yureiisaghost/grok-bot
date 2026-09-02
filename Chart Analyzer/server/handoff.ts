import fs from "node:fs"
import path from "node:path"
import type { BookMode, DeskSettings, DeskSnapshot, DriveFolderGuide, HandoffManifest, HandoffUpload } from "../src/types"
import {
  ACCOUNT_FILE,
  ACTIVE_FILE,
  ACTIVE_SESSION_JSON,
  ACTIVE_SESSION_MD,
  ARCHIVE_DIR,
  HANDOFF_BRIEF_FILE,
  HANDOFF_MANIFEST_FILE,
  LAST_REFRESH_FILE,
  LAST_REFRESH_PAPER_FILE,
  OUTCOMES_DIR,
  PAPER_ACCOUNT_FILE,
  SCANS_DIR,
  SETTINGS_FILE,
  ensureHandoffDir,
  posixRel,
  queueDirs,
  snapshotFile,
} from "./deskPaths"
import { readActiveAccount, sessionLabel } from "./accountSnapshot"
import { nowPtStamp } from "./http"
import { DEFAULT_SETTINGS } from "./picker"

export type HandoffReason = HandoffManifest["reason"]

export const DRIVE_FOLDERS: DriveFolderGuide[] = [
  { drive: "handoff/ACTIVE-SESSION.md", kind: "Phone Grok reads this first — LIVE vs PAPER" },
  { drive: "handoff/ACTIVE-SESSION.json", kind: "Machine session flag (placeCashOrders)" },
  { drive: "handoff/DESK-BRIEF.md", kind: "Decision brief after the session flag" },
  { drive: "handoff/GROK-HANDOFF.json", kind: "Exact file list for Bot to upload" },
  { drive: "desk-data/scans/", kind: "Screener keepers + .active-scan.json pointer" },
  { drive: "desk-data/scans/outcomes/", kind: "Frozen outcome cards (setup + tape fate)" },
  { drive: "desk-data/last-refresh.json", kind: "Live desk snapshot" },
  { drive: "desk-data/last-refresh-paper.json", kind: "Paper desk snapshot (kept when you switch to cash)" },
  { drive: "desk-data/paper-account.json", kind: "Paper ledger" },
  { drive: "desk-data/account.json", kind: "Short equity/heat summary for the current book" },
  { drive: "desk-data/settings.json", kind: "Risk rules + Live/Paper mode" },
  { drive: "Robinhood/Potential Tickers/", kind: "Live tickets — cash OK" },
  { drive: "Robinhood/Filled Tickers/", kind: "Live fills" },
  { drive: "Robinhood/Paper/Potential Tickers/", kind: "Paper tickets — do not place in cash" },
  { drive: "Robinhood/Paper/Filled Tickers/", kind: "Paper fills" },
]

const DRIVE_COPY = /\s\(\d+\)\.\w+$/
const NEVER_UPLOAD = [
  "Chart Analyzer/node_modules/",
  "Chart Analyzer/dist/",
  "Chart Analyzer/Temp/",
  ".bridge/",
  ".env",
  "OAuth tokens in %USERPROFILE%\\.grok-trading\\ (never Drive)",
  "desk-data/scans files named like .active-scan (1).json — Drive conflict copies",
]

function isConflictCopy(name: string) {
  return DRIVE_COPY.test(name)
}

function addFile(
  uploads: HandoffUpload[],
  abs: string,
  kind: string,
  opts?: { required?: boolean; bookMode?: BookMode },
) {
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return
  if (isConflictCopy(path.basename(abs))) return
  const local = posixRel(abs)
  uploads.push({
    local,
    drive: local,
    kind,
    bookMode: opts?.bookMode,
    required: opts?.required ?? false,
  })
}

function addDirJsonMd(
  uploads: HandoffUpload[],
  absDir: string,
  kind: string,
  bookMode?: BookMode,
) {
  if (!fs.existsSync(absDir)) return
  for (const name of fs.readdirSync(absDir)) {
    if (isConflictCopy(name)) continue
    if (!/\.(json|md)$/i.test(name)) continue
    addFile(uploads, path.join(absDir, name), kind, { bookMode })
  }
}

function readSettings(): DeskSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULT_SETTINGS }
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) as Partial<DeskSettings>
    return { ...DEFAULT_SETTINGS, ...raw, bookMode: raw.bookMode === "paper" ? "paper" : "live" }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function readSnapshot(mode: BookMode): DeskSnapshot | null {
  try {
    const file = snapshotFile(mode)
    if (!fs.existsSync(file)) return null
    return JSON.parse(fs.readFileSync(file, "utf8")) as DeskSnapshot
  } catch {
    return null
  }
}

function activeScanFiles(): string[] {
  try {
    if (!fs.existsSync(ACTIVE_FILE)) return []
    const active = JSON.parse(fs.readFileSync(ACTIVE_FILE, "utf8")) as { file?: string; json?: string; day?: string; scan?: number }
    const files = [ACTIVE_FILE]
    if (active.file) files.push(path.join(SCANS_DIR, active.file))
    const jsonName = active.json ?? (active.file ? active.file.replace(/\.md$/i, ".json") : null)
    if (jsonName) files.push(path.join(SCANS_DIR, jsonName))
    const stem = jsonName ? jsonName.replace(/\.json$/i, "") : null
    if (stem) {
      files.push(path.join(ARCHIVE_DIR, `${stem}_raw.json`))
      files.push(path.join(ARCHIVE_DIR, `${stem}_raw.md`))
    }
    return files
  } catch {
    return [ACTIVE_FILE]
  }
}

function money(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "n/a"
  return `$${n.toFixed(2)}`
}

function sessionBanner(mode: BookMode, equity: number | null | undefined, cash: number | null | undefined, perName: number | null | undefined) {
  const paper = mode === "paper"
  return `# ACTIVE SESSION: ${sessionLabel(mode)}

**Place cash / Robinhood orders: ${paper ? "NO" : "YES"}**
**Book:** ${paper ? "Paper training account" : "Live Robinhood cash"}
**Equity:** ${money(equity)}
**Cash:** ${money(cash)}
**1R slot (1%):** ${money(perName)}
**Tickets folder:** ${paper ? "`Robinhood/Paper/Potential Tickers/`" : "`Robinhood/Potential Tickers/`"}

If this file says PAPER, do not place or manage cash orders. If it says LIVE, queued tickets in Potential Tickers may be placed in Robinhood.
`
}

function writeActiveSessionFiles() {
  const active = readActiveAccount()
  const mode = active.bookMode
  const payload = {
    schema: "grok-trading-session/v1",
    active: mode,
    label: sessionLabel(mode),
    placeCashOrders: active.placeCashOrders,
    equity: active.equity,
    cash: active.cash,
    perNameRisk: active.riskPct,
    remainingHeat: active.remainingRoom,
    maxHeat: active.maxHeat,
    ticketsFolder: mode === "paper" ? "Robinhood/Paper/Potential Tickers" : "Robinhood/Potential Tickers",
    updatedAt: active.updatedAt ?? nowPtStamp(),
    instruction: mode === "paper"
      ? "PAPER session is active. Do not place orders in Robinhood cash. Use Robinhood/Paper/ only."
      : "LIVE session is active. Queued tickets in Robinhood/Potential Tickers may be placed in the cash account.",
  }
  fs.writeFileSync(ACTIVE_SESSION_JSON, JSON.stringify(payload, null, 2), "utf8")
  fs.writeFileSync(
    ACTIVE_SESSION_MD,
    `${sessionBanner(mode, active.equity, active.cash, active.riskPct)}Generated: ${nowPtStamp()}\n`,
    "utf8",
  )
}

function buildBrief(reason: HandoffReason, mode: BookMode, snapshot: DeskSnapshot | null, uploads: HandoffUpload[]) {
  const paper = mode === "paper"
  const book = snapshot?.book
  const active = readActiveAccount()
  const pick = snapshot?.pick
  const runner = snapshot?.runnerUp
  const working = snapshot?.working ?? []
  const held = snapshot?.positions ?? []
  const watch = snapshot?.nextUp ?? []
  const scan = snapshot?.scan
  const modeLine = paper
    ? "PAPER — do not place these tickets in Robinhood cash. Trade Desk fills paper on Refresh when last trades through the trigger."
    : "LIVE — phone Grok may place queued tickets from Robinhood/Potential Tickers in the cash (or broker) account."
  const heldLines = held.length
    ? held.map((pos) => `- ${pos.ticker} · ${pos.quantity} sh · last ${money(pos.lastPrice)} · stop ${money(pos.stopPrice ?? null)} · ${pos.nextRule ?? pos.heatNote}`).join("\n")
    : "- none"
  const workLines = working.length
    ? working.map((row) => `- ${row.ticker} · ${row.orderStatus ?? "queued"} · ${row.shares} sh @ ${money(row.entryPrice)} stop ${money(row.stopPrice)}`).join("\n")
    : "- none"
  const watchLines = watch.length
    ? watch.map((row) => `- ${row.ticker} · ${row.setupType} · ${row.note}`).join("\n")
    : "- none"
  const uploadLines = uploads.map((row) => `- \`${row.local}\` → Drive \`Grok Trading/${row.drive}\` (${row.kind})`).join("\n")
  const equity = book?.equity ?? active.equity
  const cash = book?.cash ?? active.cash
  const perName = book?.perNameRisk ?? active.riskPct
  return `${sessionBanner(mode, equity, cash, perName)}\n---\n\n# Trade Desk brief\n\n**Active session:** ${sessionLabel(mode)}\n**Generated:** ${nowPtStamp()}\n**Why this file exists:** Grok Bot ran Trade Desk locally. Upload the paths below to Google Drive (same relative folders). Phone Grok reads handoff/ACTIVE-SESSION.md first.\n\n## Account\n${modeLine}\n\n- Equity: ${money(equity)}\n- Cash: ${money(cash)}\n- Open heat: ${money(book?.openHeat)}\n- Pending heat: ${money(book?.pendingHeat)}\n- Leftover heat: ${money(book?.remainingHeat ?? active.remainingRoom)}\n- 1R slot: ${money(perName)}\n- Scan: ${scan?.fileName ?? "none"}\n- Last action: ${reason}\n\n## Potential\n- Pick: ${pick ? `${pick.ticker} · ${pick.shares} sh · entry ${money(pick.entryPrice)} · stop ${money(pick.stopPrice)} · ${pick.why}` : "none"}\n- Runner-up: ${runner ? `${runner.ticker} · ${runner.shares} sh · entry ${money(runner.entryPrice)} · stop ${money(runner.stopPrice)}` : "none"}\n\n## Working orders\n${workLines}\n\n## Open positions\n${heldLines}\n\n## Watchlist\n${watchLines}\n\n## Regime\n${snapshot?.regime ? `${snapshot.regime.status} — ${snapshot.regime.reason}` : "n/a"}\n\n${snapshot?.nothingReason ? `## Nothing to take\n${snapshot.nothingReason}\n` : ""}## Upload map\nCopy each local file to Google Drive **Grok Trading/** keeping the path. Do not rename. Skip Drive \`(1)\` conflict copies.\n\n${uploadLines}\n\n## Do not upload\n- Robinhood OAuth tokens\n- \`node_modules\`, \`.env\`, \`.bridge\`\n`
}

export function buildHandoff(reason: HandoffReason = "settings"): { manifest: HandoffManifest; snapshot: DeskSnapshot | null } {
  const settings = readSettings()
  const mode = settings.bookMode
  const dirs = queueDirs(mode)
  const snapshot = readSnapshot(mode)
  const uploads: HandoffUpload[] = []

  addFile(uploads, SETTINGS_FILE, "settings")
  addFile(uploads, ACTIVE_SESSION_MD, "active-session", { required: true, bookMode: mode })
  addFile(uploads, ACTIVE_SESSION_JSON, "active-session", { required: true, bookMode: mode })
  addFile(uploads, snapshotFile(mode), "desk-snapshot", { required: true, bookMode: mode })
  addFile(uploads, ACCOUNT_FILE, "account-summary", { bookMode: mode })
  addFile(uploads, PAPER_ACCOUNT_FILE, "paper-ledger", { bookMode: "paper" })
  addFile(uploads, LAST_REFRESH_FILE, "live-snapshot", { bookMode: "live" })
  addFile(uploads, LAST_REFRESH_PAPER_FILE, "paper-snapshot", { bookMode: "paper" })
  for (const file of activeScanFiles()) addFile(uploads, file, "scan")
  addDirJsonMd(uploads, OUTCOMES_DIR, "outcomes")
  addDirJsonMd(uploads, dirs.potential, paperKind("potential", mode), mode)
  addDirJsonMd(uploads, dirs.filled, paperKind("filled", mode), mode)

  const seen = new Set<string>()
  const unique = uploads.filter((row) => {
    if (seen.has(row.local)) return false
    seen.add(row.local)
    return true
  })

  return {
    snapshot,
    manifest: {
      schema: "grok-trading-handoff/v1",
      generatedAt: nowPtStamp(),
      reason,
      bookMode: mode,
      driveRoot: "Grok Trading",
      instruction: "Upload each `local` path to Google Drive folder Grok Trading at the same relative `drive` path. Do not rename. Do not upload OAuth tokens, node_modules, .env, or Drive '(1)' copies. Phone Grok should open handoff/ACTIVE-SESSION.md first — that file says LIVE or PAPER.",
      phoneGrok: {
        readFirst: "handoff/ACTIVE-SESSION.md",
        active: mode,
        placeCashOrders: mode === "live",
        doNotPlaceCashIfPaper: mode === "paper",
      },
      neverUpload: NEVER_UPLOAD,
      folders: DRIVE_FOLDERS,
      uploads: unique,
    },
  }
}

export function writeHandoff(reason: HandoffReason): HandoffManifest {
  ensureHandoffDir()
  writeActiveSessionFiles()
  const { manifest, snapshot } = buildHandoff(reason)
  fs.writeFileSync(HANDOFF_MANIFEST_FILE, JSON.stringify(manifest, null, 2), "utf8")
  fs.writeFileSync(HANDOFF_BRIEF_FILE, buildBrief(reason, manifest.bookMode, snapshot, manifest.uploads), "utf8")
  return manifest
}

export function readHandoff(): HandoffManifest {
  return buildHandoff().manifest
}

function paperKind(kind: "potential" | "filled", mode: BookMode) {
  return mode === "paper" ? `paper-${kind}` : `live-${kind}`
}
