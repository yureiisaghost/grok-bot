# Phone Grok — automations

**You create these.** After you read GitHub `README.md`, do **First session** there: create the ingest job and the hourly jobs from this file. Do not wait for Yurei to paste. Each run is a fresh chat. If this file and README fight, README wins.

Every hourly run and every daily ingest **ends by sending the Portfolio Card** in `blueprints/PHONE-PORTFOLIO-CARD.md`. That is the visual Yurei uses to decide whether to update TradingView.

There is **no ping** from Grok Bot. Time the ingest **after** a typical scan has landed in Drive `Grok Trading/desk-data/` (same paths as this README). Hourly work does **not** ingest a new universe.

Connectors on every run: **Robinhood** (Grok Trading cash account) and **Google Drive** folder **`Grok Trading/`**. That Drive folder is the same tree as this README. Open `desk-data/scans/.active-scan.json`, not a different folder name. GitHub is for the protocol (`README.md` + this file).

Grok Automations schedules are **once / daily / weekdays / weekly / monthly / yearly at one clock time**, not a true hourly cron. Hourly coverage is **seven weekday automations** that share the same prompt. If the app later offers “every hour,” use one job and keep the skip rules in the prompt.

---

## Clocks (Pacific)

| Job | When | Why |
|---|---|---|
| **Hourly Portfolio Card** | Weekdays **7:00, 8:00, 9:00, 10:00, 11:00, 12:00, 1:00 PM PT** | Live book + quotes on **Potential** and **Watch**. Full Portfolio Card. No new Bot universe. |
| **Daily ingest + Portfolio Card** | Weekdays **4:00 PM PT** | Bot starts 1:20 PM PT. Sequential MCP scan needs that gap. Then Drive MCP at the README paths, filter, replace Robinhood lists, send the Portfolio Card. |

Skip **all** of the above on NYSE full holidays and weekends (same calendar as `blueprints/GROK-BOT-AFTER-CLOSE-SCAN.md`). Columbus Day / Veterans Day: market usually **open** — run.

On **early close** (2026: Fri Nov 27, Thu Dec 24): cash session ends **10:00 AM PT**. Hourly jobs at 11:00, 12:00, and 1:00 PM PT → one line “session already closed” and stop. The **4:00 PM PT ingest still runs**.

---

## Automation 1 — Hourly Portfolio Card

**Name:** `RTH hourly — Portfolio Card`

**Schedule:** Weekdays, **seven copies**, times **7:00 / 8:00 / 9:00 / 10:00 / 11:00 / 12:00 / 1:00 PM** Pacific. Same instructions in each.

**Instructions (paste):**

```
You are Phone Grok. Read GitHub README.md and blueprints/PHONE-PORTFOLIO-CARD.md for Grok Trading first. Follow them. You are not Grok Bot. Do not download TradingView. Do not run npm run scan. Do not place a cash order unless Yurei already said take and you are finishing that ticket.

Clock: America/Los_Angeles. If today is a weekend or NYSE full holiday (NYSE calendar, not bank holidays — Good Friday is closed; Columbus Day is usually open), reply “NYSE closed” and stop.

If today is an NYSE early close (1:00 PM ET / 10:00 AM PT) and this run’s local time is after 10:00 AM PT, reply “session already closed” and stop. Do not ingest a new Bot scan on this job.

Live MCP required before any last price:
1. Book: accounts, portfolio, equity positions, open equity orders — leftover cash, equity, opens, working buys.
2. Quotes: get_equity_quotes in batches of at most 20. Quote every name on the Robinhood lists named exactly Potential and Watch, plus held names and working buys. Overlay live last onto the written setups from Drive MCP folder Grok Trading/ at desk-data/scans (active scan keepers) and desk-data/watches.json. Same relative paths as the GitHub README. Do not rank from Drive lastPrice. Do not re-run buildPlan.

Then:
- If a Potential’s live last is through the written stop, say so in What moved and remove it from the Potential list.
- If a Watch’s live last is now near the written trigger (still above the stop, not a chase through the limit), that is a positive setup. You may promote it onto Potential if leftover cash can buy at least 1 share and it is not held or working. Remove it from Watch if you add it to Potential.
- Do not add names from Bot’s full keeper dump. Do not reshuffle the universe because QQQ moved. Tape is color. Forbidden: “regime closed”, “no new heat”.
- Do not create or edit any Robinhood watchlist other than Potential and Watch.

Reply with the full Portfolio Card from blueprints/PHONE-PORTFOLIO-CARD.md (account, heat map, tape notifier, opens, every Potential stock card, every Watch stock card, plain English). Quiet hour still gets the full card so Yurei can see whether TradingView needs a look. Put changes first under What moved. Do not invent a best trade of the hour. Wait for Yurei before cash.
```

---

## Automation 2 — Daily ingest + Portfolio Card

**Name:** `After-close — ingest scan and Portfolio Card`

**Schedule:** Weekdays **4:00 PM** Pacific (one job).

**Instructions (paste):**

```
You are Phone Grok. Read GitHub README.md and blueprints/PHONE-PORTFOLIO-CARD.md for Grok Trading first. Follow them. You are not Grok Bot. Do not run the screener. Do not run npm on Yurei's PC. This job exists because Bot cannot ping you. Yurei drops today’s TradingView CSV in Drive Grok Trading/Screener Uploads/. Bot runs on Bot's own machine at 1:20 PM PT (Drive pull → npm run scan → Drive push to Grok Trading/desk-data/). You run at 4:00 PM PT and read Drive, not Bot's disk. If today’s pack is missing, say scan not up — do not treat yesterday as today.

If today is a weekend or NYSE full holiday (NYSE calendar, not bank holidays), reply “NYSE closed — no ingest” and stop. Early-close session days: still run.

1. Google Drive MCP folder Grok Trading/ — the same tree as the README. Open exactly: desk-data/scans/.active-scan.json, that scan’s full keeper .md under desk-data/scans/ (every Candidate + Developing), desk-data/regime.json, desk-data/watches.json. Do not invent a different Drive folder. Do not look for a messages/ letter. Do not ingest tickers from Screener Uploads/ — that is Yurei’s CSV drop for Bot, not the look list. The look list is NOT under Robinhood/. That folder is cash tickets only (Tickets / Filled / Stale). If Drive still has Potential Tickers / Filled Tickers / Stale Tickets, migrate real cash tickets then delete the old names. Do not recreate Paper.
2. Prove the pack is TODAY’s. .active-scan.json (and the keeper .md date) must be this Pacific session date. If the pack is missing or still yesterday: tell Yurei “scan not up yet.” Do not treat yesterday’s keepers as today’s plan. Do not empty Potential/Watch. You may still send a Portfolio Card of the live book and existing lists. Do not invent tickers.
3. Live MCP (required before any look list): book (cash, equity, positions, working orders) + get_equity_quotes in batches of 20 for every keeper + carry watches + held names. Overlay live last onto Bot’s written tickets. If quotes fail, say so and do not rank from Drive lastPrice. Do not re-run buildPlan.
4. Build today’s look list from Candidates (plus Watch names whose live last is now near): leftover cash can buy at least 1 share at the written entry; not already held or working unless Yurei asked; live last still above the written stop; not a chase through the limit ceiling. Names that do not fit stay on Drive, off the look list. QQQ/heat must not zero the look list.
5. Watch card: remaining Developing + carry watches not on the look list. Do not wipe desk-data/watches.json.
6. Mirror into Robinhood lists named exactly Potential (look list) and Watch (the watch card). Replace, do not append. Potential wins if a name is on both. No held or working names on Potential. Do not dump Bot’s full keeper file into a list. Do not touch any other watchlist. If watchlist tools fail, still send the Portfolio Card and say the app lists did not sync.
7. Reply with the full Portfolio Card from blueprints/PHONE-PORTFOLIO-CARD.md. Daily Ask: “Take, skip, or change size. Your TradingView.” No cash until Yurei says take.

If Drive has today’s pack but MCP book fails, still do not guess fills. Report the failure.
```

## First session (you do this)

1. Confirm Robinhood MCP and Google Drive folder **Grok Trading/** in this chat (same tree as GitHub README — `desk-data/`, `Robinhood/Tickets/`).
2. Read `blueprints/PHONE-PORTFOLIO-CARD.md` so the card layout is loaded.
3. On Drive, rename the ticket ledger if needed: `Robinhood/Potential Tickers` → `Tickets`, `Filled Tickers` → `Filled`, `Stale Tickets` → `Stale`. Delete `Paper` if it reappears. Do not look there for today’s scan.
4. Create Automation 2 (4:00 PM PT ingest + Portfolio Card) first.
5. Create the seven hourly copies with Automation 1’s prompt (or one native hourly job if the app has it).
6. Tell Yurei the jobs and next run times. Do not Run now on ingest unless today’s scan is on Drive and Yurei wants a test.
7. If the jobs already exist and match this file, stop. If they drifted, update in place. Never duplicate.
