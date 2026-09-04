import fs from "node:fs"
import path from "node:path"
import type { BookMode, DeskSnapshot, DriveFolderGuide, HandoffManifest, HandoffUpload } from "../src/types"
import {
  ACCOUNT_FILE,
  ACTIVE_FILE,
  ACTIVE_SESSION_JSON,
  ACTIVE_SESSION_MD,
  ARCHIVE_DIR,
  HANDOFF_BRIEF_FILE,
  HANDOFF_MANIFEST_FILE,
  LAST_REFRESH_FILE,
  OUTCOMES_DIR,
  REGIME_FILE,
  SCANS_DIR,
  SETTINGS_FILE,
  WATCHES_FILE,
  ensureHandoffDir,
  posixRel,
  queueDirs,
  snapshotFile,
} from "./deskPaths"
import { readActiveAccount } from "./accountSnapshot"
import { nowPtStamp } from "./http"

export type HandoffReason = HandoffManifest["reason"]

export const DRIVE_FOLDERS: DriveFolderGuide[] = [
  { drive: "handoff/ACTIVE-SESSION.md", kind: "Phone Grok reads this first — live cash book" },
  { drive: "handoff/ACTIVE-SESSION.json", kind: "Machine session (placeCashOrders)" },
  { drive: "handoff/DESK-BRIEF.md", kind: "Local leftover — not the book" },
  { drive: "handoff/GROK-HANDOFF.json", kind: "Exact file list for Bot to upload" },
  { drive: "desk-data/scans/", kind: "Full keeper list + .active-scan.json" },
  { drive: "desk-data/scans/outcomes/", kind: "Frozen outcome cards (setup + tape fate)" },
  { drive: "desk-data/regime.json", kind: "Tape card (QQQ/SPY/IWM) — not a trading lock" },
  { drive: "desk-data/watches.json", kind: "Carry watches Phone maintains" },
  { drive: "desk-data/last-refresh.json", kind: "Local desk snapshot — not Phone's book" },
  { drive: "desk-data/account.json", kind: "Short equity/heat summary" },
  { drive: "desk-data/settings.json", kind: "Heat guidelines" },
  { drive: "Robinhood/Tickets/", kind: "Cash tickets after Yurei says take — not the scan pack" },
  { drive: "Robinhood/Filled/", kind: "Filled tickets" },
  { drive: "Robinhood/Stale/", kind: "Dead / skipped tickets" },
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

function readSnapshot(): DeskSnapshot | null {
  try {
    const file = snapshotFile()
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
      files.push(path.join(SCANS_DIR, `${stem}_keepers.json`))
      files.push(path.join(SCANS_DIR, `${stem}_candidates.json`))
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

function sessionBanner(equity: number | null | undefined, cash: number | null | undefined, perName: number | null | undefined) {
  return `# ACTIVE SESSION: LIVE

**Book:** Grok Trading Robinhood cash
**Equity:** ${money(equity)}
**Cash:** ${money(cash)}
**1R slot (1% guideline):** ${money(perName)}
**Tickets folder:** \`Robinhood/Tickets/\`

Phone Grok filters the keeper list against leftover cash, open positions, and carry watches. Yurei says take or skip before any cash order. Tape (QQQ/SPY/IWM) is color, not a lock.
`
}

function writeActiveSessionFiles() {
  const active = readActiveAccount()
  const payload = {
    schema: "grok-trading-session/v1",
    active: "live",
    label: "LIVE",
    placeCashOrders: true,
    equity: active.equity,
    cash: active.cash,
    perNameRisk: active.riskPct,
    remainingHeat: active.remainingRoom,
    maxHeat: active.maxHeat,
    ticketsFolder: "Robinhood/Tickets",
    updatedAt: active.updatedAt ?? nowPtStamp(),
    instruction: "Live Grok Trading cash book. Phone Grok filters keepers against leftover capital. Wait for Yurei before placing.",
  }
  fs.writeFileSync(ACTIVE_SESSION_JSON, JSON.stringify(payload, null, 2), "utf8")
  fs.writeFileSync(
    ACTIVE_SESSION_MD,
    `${sessionBanner(active.equity, active.cash, active.riskPct)}Generated: ${nowPtStamp()}\n`,
    "utf8",
  )
}

function buildBrief(reason: HandoffReason, snapshot: DeskSnapshot | null, uploads: HandoffUpload[]) {
  const book = snapshot?.book
  const active = readActiveAccount()
  const pick = snapshot?.pick
  const runner = snapshot?.runnerUp
  const working = snapshot?.working ?? []
  const held = snapshot?.positions ?? []
  const watch = snapshot?.nextUp ?? []
  const scan = snapshot?.scan
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
  return `${sessionBanner(equity, cash, perName)}
---

# Trade Desk brief

**Book:** Grok Trading Robinhood cash
**Generated:** ${nowPtStamp()}
**Why this file exists:** Local leftover after Bot or Desk ran. Phone Grok reads the scan keepers + tape + Robinhood account, not this brief.

## Account
Live cash. Phone filters keepers against leftover capital. Yurei says take before any order.

- Equity: ${money(equity)}
- Cash: ${money(cash)}
- Open heat: ${money(book?.openHeat)}
- Pending heat: ${money(book?.pendingHeat)}
- Leftover heat (guideline): ${money(book?.remainingHeat ?? active.remainingRoom)}
- 1R slot (guideline): ${money(perName)}
- Scan: ${scan?.fileName ?? "none"}
- Last action: ${reason}

## Potential
- Pick: ${pick ? `${pick.ticker} · ${pick.shares} sh · entry ${money(pick.entryPrice)} · stop ${money(pick.stopPrice)} · ${pick.why}` : "none"}
- Runner-up: ${runner ? `${runner.ticker} · ${runner.shares} sh · entry ${money(runner.entryPrice)} · stop ${money(runner.stopPrice)}` : "none"}

## Working orders
${workLines}

## Open positions
${heldLines}

## Watchlist
${watchLines}

## Tape
${snapshot?.regime ? `${snapshot.regime.status} — ${snapshot.regime.reason}` : "n/a"}

${snapshot?.nothingReason ? `## Note\n${snapshot.nothingReason}\n` : ""}## Upload map
Copy each local file to Google Drive **Grok Trading/** keeping the path. Do not rename. Skip Drive \`(1)\` conflict copies.

${uploadLines}

## Do not upload
- Robinhood OAuth tokens
- \`node_modules\`, \`.env\`, \`.bridge\`
`
}

export function buildHandoff(reason: HandoffReason = "settings"): { manifest: HandoffManifest; snapshot: DeskSnapshot | null } {
  const dirs = queueDirs()
  const snapshot = readSnapshot()
  const uploads: HandoffUpload[] = []

  addFile(uploads, SETTINGS_FILE, "settings")
  addFile(uploads, ACTIVE_SESSION_MD, "active-session", { required: true, bookMode: "live" })
  addFile(uploads, ACTIVE_SESSION_JSON, "active-session", { required: true, bookMode: "live" })
  addFile(uploads, snapshotFile(), "desk-snapshot", { required: true, bookMode: "live" })
  addFile(uploads, ACCOUNT_FILE, "account-summary", { bookMode: "live" })
  addFile(uploads, REGIME_FILE, "tape")
  addFile(uploads, WATCHES_FILE, "watches")
  addFile(uploads, LAST_REFRESH_FILE, "live-snapshot", { bookMode: "live" })
  for (const file of activeScanFiles()) addFile(uploads, file, "scan")
  addDirJsonMd(uploads, OUTCOMES_DIR, "outcomes")
  addDirJsonMd(uploads, dirs.potential, "live-potential", "live")
  addDirJsonMd(uploads, dirs.filled, "live-filled", "live")

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
      bookMode: "live",
      driveRoot: "Grok Trading",
      instruction: "Upload each `local` path to Google Drive folder Grok Trading at the same relative `drive` path. Do not rename. Do not upload OAuth tokens, node_modules, .env, or Drive '(1)' copies. Phone Grok reads the full keeper .md and live Robinhood cash. Tape is not a lock.",
      phoneGrok: {
        readFirst: "handoff/ACTIVE-SESSION.md",
        active: "live",
        placeCashOrders: true,
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
  fs.writeFileSync(HANDOFF_BRIEF_FILE, buildBrief(reason, snapshot, manifest.uploads), "utf8")
  return manifest
}

export function readHandoff(): HandoffManifest {
  return buildHandoff().manifest
}
