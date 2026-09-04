# Grok Bot — after-close pipeline (fully unattended)

**This Bot creates the skill and routine.** After you read GitHub `README.md`, do **First session** there: save this skill, then create the routine from the block below. Do not wait for Yurei to paste. Time zone is **America/Los_Angeles (Pacific)**. If this file and README fight, README wins.

Your only job is the pipeline: **download the TradingView screener CSV → `npm run scan` → pack is in this Drive clone at `desk-data/`.** Phone’s Drive MCP opens those same paths. You do not present a Portfolio Card. You do not hourly-check the book. You do not edit Robinhood watchlists. You do not Place Order or Desk Refresh.

Do **not** type a homemade ticker list. Do **not** automate TradingView **login** (no saved password flow). You already know how to export the desk’s screener CSV from an existing TradingView session on this PC — that download is part of the unattended routine. If the session is dead, stop and report it; do not upload yesterday’s CSV as today.

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
- TradingView in this Bot’s browser (or the PC session you already use) so you can **export the desk screener CSV**. Do not invent tickers. Do not automate login.
- Robinhood MCP on this PC for **quotes/bars only** (`npm run rh:connect` if disconnected). Tokens stay in `%USERPROFILE%\.grok-trading\`.
- Google Drive MCP (if you use it) must open **`Grok Trading/`** at the **same relative paths** this clone uses. Phone will read those paths. Do not copy the pack into another Drive folder.

Sequence (no Yurei clicks between these steps):

1. Confirm today is an NYSE session (table above, else look up). Weekend or full holiday → stop. Post one line: “NYSE closed — no scan.” Early close → still run.
2. `git pull`. Re-read `README.md` if it changed.
3. **Download** today’s TradingView screener CSV for this desk (export you already know). Save a dated path you can pass to the scanner.
4. From `Chart Analyzer/`: `npm run scan -- --csv "<path>"`. If MCP 401, `npm run rh:connect`, then `--resume`. Sequential MCP is expected. Do not parallelize tickers. Do not click Desk Refresh or Place Order. Do not open the Vite Trade Desk. The scan writes `desk-data/scans/…` and `desk-data/regime.json` **in this clone** — that is Drive.
5. Confirm those files exist at the printed relative paths (`desk-data/scans/…`, `desk-data/regime.json`, `desk-data/watches.json` only if it was missing). Do not copy them into a different Drive folder. Do not flatten to Drive root. Skip `(1)` copies. Never put OAuth, `.env`, or `node_modules` on Drive. Do not write under `Robinhood/` (Phone’s ticket ledger).
6. Read `messages/TO-BOT.md` if present. Do only scan items. Archive it, then write `messages/TO-PHONE.md` at that path (Phone opens the same file) with scan path, Candidate count, Developing count, tape facts (no veto).

Validate:

- Working `.md` lists **every** Candidate and every Developing. Pass never writes. No dock trim.
- `desk-data/regime.json` exists (QQQ / SPY / IWM / next macro). Tape is color, not a lock.
- Stdout / `_bot-summary.json` lists the same relative paths Phone will open on Drive MCP.

Return: this conversation gets the counts, failed tickers, the relative paths (e.g. `desk-data/scans/…`), and the TO-PHONE summary. Phone Grok is not pinged; its 4:00 PM PT job opens those **same** Drive MCP paths and sends Yurei the Portfolio Card.

Approval: none for download + scan + writing the pack into this Drive clone. Stop for approval before placing any Robinhood order, editing Phone’s `watches.json` names, or changing grader gates.

If TradingView export or Robinhood MCP fails: report the failure and **do not** reuse yesterday’s scan as today’s pack. `--resume` is allowed only for the **same** CSV already in progress. Do not write the pack to a different Drive folder to “fix” a sync delay.

---

## Routine (you create this)

Create this on yourself now (same wording). If it already exists, update in place.

```
Every weekday at 1:20 PM Pacific Time (America/Los_Angeles), run the After-close keeper scan skill end to end with no one at the keyboard: download today’s TradingView screener CSV for this desk, run npm run scan from Chart Analyzer/ so files write into this Drive clone (Grok Trading/desk-data/…), write messages/TO-PHONE.md at that path. Phone Grok’s Drive MCP will open those same relative paths — do not copy the pack into another Drive folder.

Timezone: Pacific. This is 20 minutes after the regular NYSE cash close (1:00 PM PT / 4:00 PM ET). On NYSE early-close days, still run at 1:20 PM PT — the session is already over.

Before any download: if today is a weekend or an NYSE full holiday (see the skill calendar; use NYSE not bank holidays), do not scan. Post “NYSE closed — no scan” and stop.

Expected result: full Candidate + Developing keeper pack at desk-data/scans/ in Drive folder Grok Trading/, tape card at desk-data/regime.json, TO-PHONE letter at messages/TO-PHONE.md. Phone Grok will send Yurei the Portfolio Card. Do not Place Order. Do not Refresh the Desk. Do not edit Robinhood watchlists. Do not present Yurei a trading plan.

If TradingView export or Robinhood MCP is unavailable, report the failure in this conversation. Do not treat yesterday’s scan as today’s pack. Do not write keepers to a different Drive path.
```

After you create it: confirm next run is a weekday 1:20 PM PT in this chat. Do **not** Test run unless Yurei asks on a session day (a test does real work).
