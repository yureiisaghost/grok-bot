# Grok Bot — after-close pipeline (fully unattended)

**This Bot creates the skill and routine.** After you read GitHub `README.md`, do **First session** there: save this skill, then create the routine from the block below. Do not wait for Yurei to paste. Time zone is **America/Los_Angeles (Pacific)**. If this file and README fight, README wins.

**You run on your machine.** You do not run on Yurei’s PC. You do not use Yurei’s Drive Desktop folder as your working directory. You do not ask Yurei to start `npm` for you.

Your only job: **Drive MCP pull `Grok Trading/Screener Uploads/` → skip if nothing new → `npm run scan` on your disk → Drive MCP push the pack back to `Grok Trading/` at the same relative paths.** After a successful scan, archive old screeners locally and upload that maintained folder. Phone reads Drive, not your disk. You do not present a Portfolio Card. You do not Place Order.

TradingView no longer shows the screener to Bots. **Yurei** drops the `.csv` on Drive. You pull it. Do **not** invent a ticker list.

---

## Session clock (why 1:20 PM PT)

US cash equities close **1:00 PM PT** (4:00 PM ET) on a full session, and **10:00 AM PT** (1:00 PM ET) on NYSE early-close days.

The routine is **weekdays at 1:20 PM PT** — twenty minutes after a **full** close. On early-close days, still run at 1:20 PM PT. Do not also schedule a 10:20 AM PT run.

---

## NYSE calendar (skip closed days)

**Use the NYSE / Nasdaq cash-equity calendar, not the Federal Reserve bank holiday list.** Columbus Day and Veterans Day are often bank holidays; the stock market is usually **open**. Good Friday the market is **closed** even if banks are open.

### Full-session closed (do not scan)

| 2026 | Holiday |
|---|---|
| Thu Jan 1 | New Year’s Day |
| Mon Jan 19 | Martin Luther King, Jr. Day |
| Mon Feb 16 | Washington’s Birthday |
| Fri Apr 3 | Good Friday |
| Mon May 25 | Memorial Day |
| Fri Jun 19 | Juneteenth |
| Fri Jul 3 | Independence Day (observed) |
| Mon Sep 7 | Labor Day |
| Thu Nov 26 | Thanksgiving |
| Fri Dec 25 | Christmas Day |

### Early close 1:00 PM ET / 10:00 AM PT (still scan at 1:20 PM PT)

| 2026 | Day |
|---|---|
| Fri Nov 27 | Day after Thanksgiving |
| Thu Dec 24 | Christmas Eve |

Weekends: the weekday schedule should not fire. If it does, treat as closed and stop.

For 2027+ (or any date not in the table), look up **NYSE holidays and early closings** for that year before scanning. Do not guess.

---

## Skill (save this as “After-close keeper scan”)

When to use: unattended after the US cash-equity close on a session day, or when Yurei asks for a rescan. Not on NYSE holidays. Not to trade. Not to build Phone’s Portfolio Card. Not on Yurei’s PC.

Required inputs and access (all on **your** machine):

- GitHub clone of `https://github.com/yureiisaghost/grok-bot`. `git pull` first. Work from the folder root so `desk-data/` sits beside `Chart Analyzer/`.
- **Google Drive MCP** folder **`Grok Trading/`**. This is how you see Yurei’s CSV and how Phone sees your pack. Do not invent another Drive folder.
- Robinhood MCP on **your** machine for quotes/bars only (`npm run rh:connect` if disconnected). Tokens stay in `~/.grok-trading/` on your home. Never Yurei’s tokens.

Sequence (no Yurei clicks, no Yurei PC):

1. Confirm today is an NYSE session (table above, else look up). Weekend or full holiday → stop. Post one line: “NYSE closed — no scan.” Early close → still run.
2. `git pull` on **your** clone. Re-read `README.md` if it changed.
3. Drive MCP: poll `Grok Trading/Screener Uploads/` for up to 20 minutes for a **new** CSV (new file or overwrite vs Drive `.last-used.json`). Skip Drive `(1)` copies. If nothing new → post “no new screener — skip” and stop.
4. Pull into your clone at the same relative paths: the new CSV, `Screener Uploads/.last-used.json` if it exists, `desk-data/watches.json`, `desk-data/settings.json`. `npm run bot:drive` prints this list.
5. From `Chart Analyzer/` on **your** machine: `npm run scan -- --wait-minutes 0`. If MCP 401, `npm run rh:connect`, then `--resume`. Sequential MCP. Do not parallelize. Do not open TradingView. Do not open Yurei’s Vite Desk.
6. Drive MCP **upload** every path printed by the scan (`*_bot-drive.json` / “upload” list) to `Grok Trading/` at those exact relative paths. That includes keepers, `.active-scan.json`, `desk-data/regime.json`, maintained `Screener Uploads/` (current CSV only in the immediate folder; old CSVs under `Archive/`). Confirm they exist on Drive. Do not flatten to Drive root. Never upload `~/.grok-trading/`, `.env`, or `node_modules`. Do not write under `Robinhood/`.

Validate:

- Drive `desk-data/scans/` working `.md` lists every Candidate and every Developing. Pass never writes. No dock trim.
- Drive `desk-data/regime.json` exists. Tape is color, not a lock.
- A file that exists only on your clone is **not** done.

Return: this conversation gets the counts, failed tickers, and the Drive relative paths. Phone is not pinged; its 4:00 PM PT job opens Drive.

Approval: none for Drive pull, skip, local scan, archive, and Drive push. Stop for approval before any Robinhood **order**, editing Phone’s watch names, or changing grader gates.

If Robinhood MCP fails on a new file: report it. Do not treat yesterday’s Drive pack as today’s. `--resume` is only for the same CSV already in progress.

---

## Routine (you create this)

Create this on yourself now (same wording). If it already exists, update in place.

```
Every weekday at 1:20 PM Pacific Time (America/Los_Angeles), run the After-close keeper scan skill end to end on YOUR machine — never Yurei's PC. git pull this repo. Use Google Drive MCP on folder Grok Trading/. Poll Screener Uploads/ for a new CSV (up to 20 minutes). If none, skip. If new, pull it into your clone with .last-used.json, watches.json, and settings.json, then from Chart Analyzer/ run npm run scan -- --wait-minutes 0, then upload every printed path back to Drive Grok Trading/ at the same relative paths. Phone reads Drive, not your disk. Do not write a messages/ letter. Do not open TradingView. Do not run commands on Yurei's computer.

Timezone: Pacific. This is 20 minutes after the regular NYSE cash close (1:00 PM PT / 4:00 PM ET). On NYSE early-close days, still run at 1:20 PM PT.

Before any scan: if today is a weekend or an NYSE full holiday (see the skill calendar; use NYSE not bank holidays), do not scan. Post “NYSE closed — no scan” and stop.

Expected result: either “no new screener — skip”, or today’s keeper pack visible on Drive at desk-data/scans/ plus desk-data/regime.json, with Screener Uploads/ on Drive holding only the current CSV. Do not Place Order. Do not present Yurei a trading plan.

If Robinhood MCP is unavailable on a new file, report the failure in this conversation. Do not invent a ticker list. Do not leave the pack only on your machine.
```

After you create it: confirm next run is a weekday 1:20 PM PT in this chat, and that it runs on **your** machine. Do **not** Test run unless Yurei asks on a session day.
