# Grok Bot — after-close pipeline (fully unattended)

**This Bot creates the skill and routine.** After you read GitHub `README.md`, do **First session** there: save this skill, then create the routine from the block below. Do not wait for Yurei to paste. Time zone is **America/Los_Angeles (Pacific)**. If this file and README fight, README wins.

Your only job is the pipeline: **check `Screener Uploads/` for a new CSV → skip if none → `npm run scan` if new → pack is in this Drive clone at `desk-data/`.** After a successful scan, archive old screeners so only the current CSV stays in `Screener Uploads/`. Phone’s Drive MCP opens the keeper paths. You do not present a Portfolio Card. You do not hourly-check the book. You do not edit Robinhood watchlists. You do not Place Order or Desk Refresh.

TradingView no longer shows the screener to Bots. **Yurei** exports it after the cash close and drops the `.csv` in Drive `Grok Trading/Screener Uploads/` (this clone). Do **not** type a homemade ticker list. Do **not** open TradingView. Do **not** download or export the screener. You **do** maintain `Screener Uploads/`: archive old CSVs into `Screener Uploads/Archive/`. If there is no new screener after the wait, skip — that is not a failed scan.

---

## Session clock (why 1:20 PM PT)

US cash equities close **1:00 PM PT** (4:00 PM ET) on a full session, and **10:00 AM PT** (1:00 PM ET) on NYSE early-close days.

The routine is **weekdays at 1:20 PM PT** — twenty minutes after a **full** close. That is after last prints, and it is still after close on early-close days (Bot just starts later relative to that day’s bell). Do not also schedule a 10:20 AM PT run; one weekday slot is enough.

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

When to use: unattended after the US cash-equity close on a session day, or when Yurei asks for a rescan. Not on NYSE holidays. Not to trade. Not to build Phone’s Portfolio Card.

Required inputs and access:

- GitHub clone of Grok Trading on this PC — **this clone is Drive folder `Grok Trading/`**. `git pull` first so the protocol matches GitHub. Work from the **folder root** so `desk-data/` sits beside `Chart Analyzer/`.
- A **new** screener CSV in `Screener Uploads/` (Yurei drops it; Drive Desktop lands it here). If none lands, skip. Do not invent tickers.
- Robinhood MCP on this PC for **quotes/bars only** (`npm run rh:connect` if disconnected). Tokens stay in `%USERPROFILE%\.grok-trading\`.
- Google Drive MCP (if you use it) must open **`Grok Trading/`** at the **same relative paths** this clone uses. Phone will read those paths. Do not copy the pack into another Drive folder.

Sequence (no Yurei clicks between these steps):

1. Confirm today is an NYSE session (table above, else look up). Weekend or full holiday → stop. Post one line: “NYSE closed — no scan.” Early close → still run.
2. `git pull`. Re-read `README.md` if it changed.
3. From `Chart Analyzer/`: `npm run scan`. That command checks `Screener Uploads/` for a **new** CSV (waits up to 20 minutes for Drive). No new file → skip, no scan. New file → grade it, then archive every other CSV into `Screener Uploads/Archive/` so only the current screener stays in the immediate folder. Do not pass a homemade ticker list. If MCP 401, `npm run rh:connect`, then `npm run scan -- --resume`. Sequential MCP is expected. Do not parallelize tickers. Do not click Desk Refresh or Place Order. Do not open the Vite Trade Desk. Do not open TradingView. The scan writes `desk-data/scans/…` and `desk-data/regime.json` **in this clone** — that is Drive.
4. Confirm those files exist at the printed relative paths (`desk-data/scans/…`, `desk-data/regime.json`, `desk-data/watches.json` only if it was missing). Do not copy them into a different Drive folder. Do not flatten to Drive root. Skip `(1)` copies. Never put OAuth, `.env`, or `node_modules` on Drive. Do not write under `Robinhood/` (Phone’s ticket ledger). There is no Drive mailbox — do not write `messages/TO-PHONE.md`. Counts and paths stay in this conversation.

Validate:

- Working `.md` lists **every** Candidate and every Developing. Pass never writes. No dock trim.
- `desk-data/regime.json` exists (QQQ / SPY / IWM / next macro). Tape is color, not a lock.
- Stdout / `_bot-summary.json` lists the same relative paths Phone will open on Drive MCP.

Return: this conversation gets the counts, failed tickers, and the relative paths (e.g. `desk-data/scans/…`). Phone Grok is not pinged; its 4:00 PM PT job opens those **same** Drive MCP paths and sends Yurei the Portfolio Card.

Approval: none for checking `Screener Uploads/`, skipping when nothing is new, scanning a new CSV, archiving old screeners, and writing the pack into this Drive clone. Stop for approval before placing any Robinhood order, editing Phone’s `watches.json` names, or changing grader gates.

If there is no new CSV after the wait: post “no new screener — skip” and stop. That is success, not a failure. If Robinhood MCP fails on a new file: report it and **do not** reuse yesterday’s scan as today’s pack. `--resume` is allowed only for the **same** CSV already in progress. Do not write the pack to a different Drive folder to “fix” a sync delay.

---

## Routine (you create this)

Create this on yourself now (same wording). If it already exists, update in place.

```
Every weekday at 1:20 PM Pacific Time (America/Los_Angeles), run the After-close keeper scan skill end to end with no one at the keyboard: from Chart Analyzer/ run npm run scan. That checks Grok Trading/Screener Uploads/ for a new CSV (Yurei drops it after the close; wait up to 20 minutes for Drive). If there is no new screener, skip — do not scan, do not invent tickers. If there is a new screener, grade it, write desk-data/ in this Drive clone, and archive every other CSV into Screener Uploads/Archive/ so only the current file stays in the immediate folder. Phone Grok’s Drive MCP will open the keeper paths — do not copy the pack into another Drive folder. Do not write a messages/ letter. Do not open TradingView.

Timezone: Pacific. This is 20 minutes after the regular NYSE cash close (1:00 PM PT / 4:00 PM ET). On NYSE early-close days, still run at 1:20 PM PT — the session is already over.

Before any scan: if today is a weekend or an NYSE full holiday (see the skill calendar; use NYSE not bank holidays), do not scan. Post “NYSE closed — no scan” and stop.

Expected result: either “no new screener — skip”, or a full Candidate + Developing keeper pack at desk-data/scans/ in Drive folder Grok Trading/, tape card at desk-data/regime.json, and Screener Uploads/ left with only the current CSV. Phone Grok will send Yurei the Portfolio Card when a pack landed. Do not Place Order. Do not Refresh the Desk. Do not edit Robinhood watchlists. Do not present Yurei a trading plan.

If Robinhood MCP is unavailable on a new file, report the failure in this conversation. Do not treat yesterday’s scan as today’s pack. Do not invent a ticker list. Do not write keepers to a different Drive path.
```

After you create it: confirm next run is a weekday 1:20 PM PT in this chat. Do **not** Test run unless Yurei asks on a session day (a test does real work).
