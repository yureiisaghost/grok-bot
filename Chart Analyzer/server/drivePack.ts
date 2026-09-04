/** Drive folder Grok Trading/ — shared state. Bot's GitHub clone is not this. */

export const DRIVE_FOLDER = "Grok Trading"

/** Pull these from Drive onto Bot's machine before deciding new-vs-skip. */
export const DRIVE_PULL_BEFORE_SCAN = [
  "Screener Uploads/.last-used.json",
  "Screener Uploads/",
  "desk-data/watches.json",
  "desk-data/settings.json",
] as const

/** Never upload from either machine. */
export const DRIVE_NEVER_UPLOAD = [
  "node_modules/",
  ".env",
  ".bridge/",
  "~/.grok-trading/",
  "Chart Analyzer/Temp/",
  "messages/",
] as const

export function drivePushAfterScan(opts: {
  stem: string | null
  scanFile: string | null
  screenerRel: string[]
}): string[] {
  const keepers = opts.stem
    ? [
        opts.scanFile ? `desk-data/scans/${opts.scanFile}` : null,
        `desk-data/scans/${opts.stem}.json`,
        `desk-data/scans/${opts.stem}_keepers.json`,
        `desk-data/scans/${opts.stem}_candidates.json`,
        `desk-data/scans/${opts.stem}_bot-summary.json`,
        `desk-data/scans/${opts.stem}_bot-drive.json`,
      ]
    : []
  return [
    ...keepers,
    "desk-data/scans/.active-scan.json",
    "desk-data/scans/outcomes/",
    "desk-data/regime.json",
    "desk-data/watches.json",
    ...opts.screenerRel,
  ].filter((row): row is string => Boolean(row))
}
