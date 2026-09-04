import fs from "node:fs"
import path from "node:path"

const DRIVE_DUP = / \(\d+\)(\.[^.]+)?$/i
export const LAST_USED_FILE = ".last-used.json"

/** Drive MCP pull is the wait. Local scan starts after the CSV is already on Bot's disk. */
export const DEFAULT_WAIT_MS = 0
export const DEFAULT_POLL_MS = 15_000

export function pacificDate(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at)
}

export function isDriveDuplicateName(name: string): boolean {
  return DRIVE_DUP.test(name)
}

export function isCsvFileName(name: string): boolean {
  if (name.startsWith(".")) return false
  if (!name.toLowerCase().endsWith(".csv")) return false
  if (isDriveDuplicateName(name)) return false
  return true
}

function isCsvIncludingDupes(name: string): boolean {
  if (name.startsWith(".")) return false
  return name.toLowerCase().endsWith(".csv")
}

export type ScreenerFile = { abs: string; name: string; mtimeMs: number; size: number }

export type LastUsedScreener = {
  name: string
  mtimeMs: number
  size: number
  scannedAt: string
}

export function lastUsedPath(uploadsDir: string) {
  return path.join(uploadsDir, LAST_USED_FILE)
}

export function archiveDir(uploadsDir: string) {
  return path.join(uploadsDir, "Archive")
}

export function loadLastUsed(uploadsDir: string): LastUsedScreener | null {
  try {
    const raw = fs.readFileSync(lastUsedPath(uploadsDir), "utf8")
    const parsed = JSON.parse(raw) as LastUsedScreener
    if (!parsed?.name || typeof parsed.mtimeMs !== "number" || typeof parsed.size !== "number") return null
    return parsed
  } catch {
    return null
  }
}

export function writeLastUsed(uploadsDir: string, file: ScreenerFile) {
  const rec: LastUsedScreener = {
    name: file.name,
    mtimeMs: file.mtimeMs,
    size: file.size,
    scannedAt: new Date().toISOString(),
  }
  fs.writeFileSync(lastUsedPath(uploadsDir), JSON.stringify(rec, null, 2), "utf8")
}

export function matchesLastUsed(file: ScreenerFile, last: LastUsedScreener | null): boolean {
  if (!last) return false
  return file.name === last.name && file.mtimeMs === last.mtimeMs && file.size === last.size
}

function statCsv(abs: string, name: string): ScreenerFile | null {
  try {
    const st = fs.statSync(abs)
    if (!st.isFile()) return null
    return { abs, name, mtimeMs: st.mtimeMs, size: st.size }
  } catch {
    return null
  }
}

export function fingerprintPath(abs: string): ScreenerFile | null {
  return statCsv(abs, path.basename(abs))
}

/** CSVs Bot may grade: top of Screener Uploads only, no Archive, no Drive (1) copies. */
export function listImmediateScanCsvs(uploadsDir: string): ScreenerFile[] {
  if (!fs.existsSync(uploadsDir)) return []
  const rows: ScreenerFile[] = []
  for (const name of fs.readdirSync(uploadsDir)) {
    if (!isCsvFileName(name)) continue
    const file = statCsv(path.join(uploadsDir, name), name)
    if (file) rows.push(file)
  }
  return rows
}

export function listImmediateCsvsIncludingDupes(uploadsDir: string): ScreenerFile[] {
  if (!fs.existsSync(uploadsDir)) return []
  const rows: ScreenerFile[] = []
  for (const name of fs.readdirSync(uploadsDir)) {
    if (!isCsvIncludingDupes(name)) continue
    const file = statCsv(path.join(uploadsDir, name), name)
    if (file) rows.push(file)
  }
  return rows
}

export function pickNewCsv(uploadsDir: string, last = loadLastUsed(uploadsDir)): ScreenerFile | null {
  const rows = listImmediateScanCsvs(uploadsDir).filter((file) => !matchesLastUsed(file, last))
  if (!rows.length) return null
  rows.sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
  return rows[0]
}

function uniqueArchiveAbs(archive: string, file: ScreenerFile): string {
  const stamp = pacificDate(new Date(file.mtimeMs))
  const dest = path.join(archive, `${stamp}_${file.name}`)
  if (!fs.existsSync(dest)) return dest
  const stem = file.name.replace(/\.csv$/i, "")
  for (let n = 2; n < 1000; n++) {
    const alt = path.join(archive, `${stamp}_${stem}_${n}.csv`)
    if (!fs.existsSync(alt)) return alt
  }
  return path.join(archive, `${stamp}_${stem}_${Date.now()}.csv`)
}

function moveFile(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  try {
    fs.renameSync(from, to)
  } catch {
    fs.copyFileSync(from, to)
    fs.unlinkSync(from)
  }
}

/** Move every CSV except `keepAbs` into Archive/. Drive (1) copies always go. */
export function archiveOtherScreeners(uploadsDir: string, keepAbs: string | null): string[] {
  const archive = archiveDir(uploadsDir)
  fs.mkdirSync(archive, { recursive: true })
  const keep = keepAbs ? path.resolve(keepAbs) : null
  const moved: string[] = []
  for (const file of listImmediateCsvsIncludingDupes(uploadsDir)) {
    if (keep && path.resolve(file.abs) === keep) continue
    const dest = uniqueArchiveAbs(archive, file)
    try {
      moveFile(file.abs, dest)
      moved.push(dest)
    } catch (err) {
      console.warn(`[scan] could not archive ${file.name}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return moved
}

export function maintainScreenerFolder(uploadsDir: string, currentAbs: string): { archived: string[]; lastUsed: ScreenerFile | null } {
  const archived = archiveOtherScreeners(uploadsDir, currentAbs)
  const current = fingerprintPath(currentAbs)
  if (current) writeLastUsed(uploadsDir, current)
  return { archived, lastUsed: current }
}

/** No new scan: keep the last-used current CSV, archive Drive dupes and strays. */
export function tidyScreenerFolderOnSkip(uploadsDir: string): string[] {
  const last = loadLastUsed(uploadsDir)
  const current = listImmediateScanCsvs(uploadsDir).find((file) => matchesLastUsed(file, last)) ?? null
  return archiveOtherScreeners(uploadsDir, current?.abs ?? null)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function waitForNewCsv(
  uploadsDir: string,
  opts: { waitMs?: number; pollMs?: number; log?: (line: string) => void; now?: () => number } = {},
): Promise<ScreenerFile | null> {
  const waitMs = opts.waitMs ?? DEFAULT_WAIT_MS
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS
  const log = opts.log
  const now = opts.now ?? Date.now
  const deadline = now() + Math.max(0, waitMs)
  let announced = false

  for (;;) {
    const found = pickNewCsv(uploadsDir)
    if (found) return found
    if (now() >= deadline) return null
    if (!announced) {
      log?.(`[scan] no new screener in Screener Uploads yet. Waiting for Drive (up to ${Math.ceil(waitMs / 60000)} min).`)
      announced = true
    }
    const remaining = deadline - now()
    await sleep(Math.min(pollMs, Math.max(0, remaining)))
  }
}
