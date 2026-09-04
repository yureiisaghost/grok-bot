# Grok Trading — operating manual

**This file is the only protocol.** Grok Bot and Phone Grok both pull it from GitHub. After a push, this Drive clone (`Grok Trading/`) has the same file at the same path. If an old chat, the Trade Desk UI, `handoff/DESK-BRIEF.md`, or `desk-data/last-refresh*.json` disagrees with this file, **this file wins**.

Yurei trades **charts**. You report the tape and the heat so the picture is honest. You do **not** decide that the account is closed, gated, parked, or “no new heat.” That call is Yurei’s, every time.

---

## If you are Grok Bot, start here

1. Read **Shared rules**, then **Grok Bot**.
2. Open `blueprints/GROK-BOT-AFTER-CLOSE-SCAN.md` in this repo (same commit as this README).
3. **Before any scan:** create the skill and the weekday **1:20 PM PT unattended** routine from that file (check `Screener Uploads/` for a **new** CSV → scan if new, skip if not → pack lands in this Drive clone). If they already exist and match, leave them. If they drifted (including an old “download from TradingView” or “always scan today’s file” routine), update in place — do not create a second after-close routine. Tell Yurei the next run time.
4. Do not run Phone’s job.

## If you are Phone Grok, start here

1. Read **Shared rules**, then **Phone Grok**.
2. Open `blueprints/PHONE-GROK-AUTOMATIONS.md` and `blueprints/PHONE-PORTFOLIO-CARD.md` (GitHub or this Drive clone — same files, same paths).
3. **Before any ingest:** create the weekdays 4:00 PM PT ingest automation and the seven RTH hourly automations from the automations file. Those jobs must send the **Portfolio Card**. If they already exist and match, leave them. If they drifted, update in place — do not duplicate. Tell Yurei they are on.
4. Do not run Bot’s job.

---

# Shared rules

## Who is who

| Who | Where | Job |
|---|---|---|
| **Yurei** | Charts + the phone chat | The only person who says take, skip, or size override. After the cash close, exports the TradingView screener and drops the CSV in `Screener Uploads/`. |
| **Grok Bot** | This Drive-synced clone on the PC | Unattended pipeline: check `Screener Uploads/` for a **new** CSV → if none, skip → if new, `npm run scan` (writes `desk-data/` **here**) and archive old screeners. Phone reads those same paths on Drive MCP. Scanner only. Does not open TradingView. |
| **Phone Grok** | Yurei’s phone, a normal Grok chat | Final filter against the **live** Grok Trading Robinhood cash account. Live MCP quotes. Robinhood `Potential` / `Watch` lists. Sends Yurei the **Portfolio Card** on every hourly and every daily ingest so he can decide whether to update TradingView. Waits for take/skip before cash. |

There is **no database**. Durable state is files in **one folder tree**. Google Drive folder **`Grok Trading/`** is this clone (same relative paths). GitHub holds the code and this manual so both Groks can pull the protocol. Robinhood the **app** is the broker, not a Drive folder.

This app **does not place broker orders**. Bot grades names. Phone talks to Yurei and writes tickets. Cash orders exist only after Yurei says **take**.

There is **no paper book**. No Live/Paper toggle. No `$1,000` trainer ledger. No `Robinhood/Paper/`. The only book is the Grok Trading Robinhood **cash** account. Do not migrate old paper positions into cash.

## What you never do (both of you)

- Never hide a Candidate because QQQ, SPY, IWM, heat, FOMC, CPI, or NFP “says no.”
- Never tell Yurei “we cannot trade today” because the index is unstacked or heat is at the guideline.
- Never upload or commit `%USERPROFILE%\.grok-trading\` (OAuth), `.env`, `node_modules`, `.bridge`, or Drive copies named like `file (1).md`.
- Never treat `handoff/DESK-BRIEF.md` or `desk-data/last-refresh*.json` as the book.
- Never invent tickers. Bot only grades names from a **new** CSV in `Screener Uploads/` (plus names Yurei explicitly adds). Do not type a homemade universe. If there is no new screener, do not scan.
- Never trim Bot’s keeper `.md` down to a dock of 20. Phone may drop names from the **look list** for capital fit; the full list stays on Drive.
- Never dump Bot’s full keeper list into a Robinhood watchlist. The app lists are Phone’s filtered **Potential** and **Watch** only.
- Never invent Drive folders or different relative paths. Phone’s Drive MCP and this clone are the **same tree**. `desk-data/scans/.active-scan.json` here is `desk-data/scans/.active-scan.json` on Drive — not `Scans/`, not Drive root, not `Phone Pack/`.
- Never recreate `messages/` or write Bot↔Phone letters. Clocks plus the Drive pack are the handoff.

## Yurei decides — locked

Yurei reads **price** on the name in front of him. Indexes can disagree with that chart. So:

1. **Take / skip / wait** is Yurei’s. You recommend. He confirms.
2. **Size** is Yurei’s. You show a 1% *suggestion* and the current heat. He can take more, less, or none.
3. **Macro days** (FOMC, CPI, NFP) are on the tape card so he can see them. They are **not** an automatic shutoff.

If Yurei says “take X,” you take X even if QQQ is unstacked, SPY weekly is down, or heat is already near the 6% *guideline*. If Yurei says “nothing today,” you take nothing even if the scan is full of Candidates.

## Market tape — track it, do not cap with it

Bot publishes a tape snapshot with every scan (`desk-data/regime.json`). Phone prints it on every **Portfolio Card** (hourly and daily). It is **color**, not a gate.

Always include, when the data is available:

| Symbol | Why it is there | Facts to print |
|---|---|---|
| **QQQ** | Nasdaq-100, the desk’s main index | Last, SMA10, SMA20, stacked (SMA10 > SMA20 yes/no) |
| **SPY** | S&P 500 | Last, weekly stage if you have it (up / down / sideways) |
| **IWM** | Russell 2000 / risk appetite | Last, and SMA10/SMA20 if you have them |
| **DIA** | Dow, optional | Last if you already pulled it; do not block a scan to get it |

Also print **next macro** (FOMC / CPI / NFP date) when known.

**Forbidden language for tape:** “regime closed,” “tape parked,” “no new heat,” “blackout — cannot take names,” “allowsNewHeat: false so we skip,” “unstacked so half size only.”

**Allowed language:** “QQQ 10/20 is not stacked. SPY weekly is down. Heat is $X of a $Y guideline. Yurei, the charts on these names still look like this — your call.”

QQQ / heat **must not** empty the look list.

## Heat — track it, do not lock the account

Heat is dollars at risk if stops hit: for each open or working name, `shares × max(0, last − stop)` (use the written stop). Sum that. Compare it to a **guideline**, not a wall.

Guidelines in `desk-data/settings.json` (defaults):

- **1%** of equity as a *suggested* 1R slot for a new name
- **6%** of equity as a *suggested* max heat
- **2** new names as a *suggested* cap

Phone **shows** leftover heat, open heat, pending heat, and the 1% suggestion on every **Portfolio Card**. Phone does **not** refuse a name because leftover heat is smaller than 1R, cluster is “full,” or two names are already working. Say “this would put heat at $A vs a $B guideline” and wait for Yurei.

Pending buys still **count** in the heat you display, so the number is honest.

## Capital fit (Phone only — not a QQQ shutoff)

Phone **can** drop a name from the **look list** when leftover **cash** cannot take a real ticket (at least 1 share at the written entry, and a size that is not a joke vs equity). A $200 name on $54 cash is not a take recommendation. That name **stays on Drive** in the full keeper list.

Do not double a name already held or working unless Yurei asks.

## One day, two clocks (Pacific)

Jobs live in `blueprints/GROK-BOT-AFTER-CLOSE-SCAN.md` and `blueprints/PHONE-GROK-AUTOMATIONS.md`. The visual Phone sends is `blueprints/PHONE-PORTFOLIO-CARD.md`. **Each Grok creates those jobs in First session** after reading this README. There is **no ping** from Bot to Phone.

| Clock | Who | Pacific time | What |
|---|---|---|---|
| Screener drop | **Yurei** | After the cash close (regular **1:00 PM PT**, early close **10:00 AM PT**) | Export the TradingView screener yourself and upload the `.csv` to Drive `Grok Trading/Screener Uploads/`. Bots cannot see the TradingView screener. |
| After close | **Grok Bot** routine | Weekdays **1:20 PM PT** | Unattended: check `Screener Uploads/` for a **new** CSV (wait up to 20 minutes for Drive). No new file → skip, no scan. New file → `npm run scan`, then archive old CSVs so only the current screener stays in that folder. Phone’s Drive MCP reads `desk-data/`. On NYSE **early close** this time is still after the bell. |
| Hourly RTH | **Phone Grok** automations | Weekdays **7:00–1:00 PM PT** on the hour | Live book + quotes on **Potential** and **Watch**. Send the full **Portfolio Card** (`blueprints/PHONE-PORTFOLIO-CARD.md`). May promote a Watch that is now near; drop a Potential that died on its own stop. No new universe from Bot’s full dump. Seven weekday jobs if the app has no true hourly cron. |
| Ingest scan | **Phone Grok** automation | Weekdays **4:00 PM PT** | Drive MCP: today’s pack at the paths in **Files** (Bot started 1:20 PM PT). Live-quote, capital-fit look list, replace Robinhood `Potential` / `Watch`, send the **Portfolio Card**. If today’s pack is missing, say “scan not up” — do not treat yesterday as today. |

**NYSE closed (no Bot scan, no Phone ingest, no hourly):** weekends and NYSE **full** holidays. Use the NYSE cash-equity calendar, **not** bank holidays. Good Friday is closed. Columbus Day is usually **open**. 2026 dates are in the Bot blueprint.

**Early close (still ingest at 4:00 PM PT):** 2026 Fri Nov 27 and Thu Dec 24 (1:00 PM ET / 10:00 AM PT). Hourly slots after 10:00 AM PT that day: “session already closed.”

## One tree: GitHub, this clone, and Drive MCP

Yurei’s working folder **is** Google Drive folder **`Grok Trading/`**. What you write here is what Drive MCP sees. There is no second layout for Bot or Phone.

| Place | What it is | What you do with it |
|---|---|---|
| **This clone / Drive `Grok Trading/`** | The **only** working tree. `Screener Uploads/`, `desk-data/`, `Robinhood/Tickets/`, `handoff/`, `blueprints/` sit at this root. | Yurei drops the screener CSV in `Screener Uploads/`. Bot writes the scan pack here. Phone’s **Google Drive MCP** opens these **same relative paths**. Do not rename, nest, or flatten them. |
| **GitHub (this repo)** | Code + **this README** + blueprints. Both Groks **pull the protocol** from here. | After a push, `git pull` in this clone so Drive has the new manual. GitHub is **not** a second scan archive. Do not look on GitHub for today’s keepers. |
| **Robinhood the app** | Live cash book, live orders, live quotes, and Phone’s `Potential` / `Watch` **lists**. | MCP on the phone chat. The Drive folder named `Robinhood/` is **tickets only**, not the app. Never copy OAuth tokens (`%USERPROFILE%\.grok-trading\`) to GitHub or Drive. |

**Paths are literal.** If this README says `desk-data/regime.json`, Drive MCP must open `Grok Trading/desk-data/regime.json`. Skip conflict copies (`(1)` in the filename). Do not create `Grok Trading/Grok Trading/`.

If you are Bot and this clone is already Drive-synced: writing the scan files **is** the Drive write. Do not copy the pack into another Drive folder. If you must confirm Drive MCP, confirm the **same** paths.

---

# Two pipes (do not mix)

The Drive folder named `Robinhood/` is **not** Bot’s drop for Phone. That was the original idea; it is not how the desk runs.

### 0. Universe CSV — Yurei writes, Bot reads

TradingView does **not** show the screener to Bots. After the cash close, **Yurei** exports the desk screener and drops the `.csv` in `Screener Uploads/` (Drive `Grok Trading/Screener Uploads/`, this clone). Overwrite is fine. Bot’s 1:20 PM PT job **checks for a new file** (`npm run scan` with no path). If nothing is new, it skips — that is not a failed scan. If a new CSV is there, it grades it, then **archives** every other CSV into `Screener Uploads/Archive/` so only the current screener stays in the immediate folder. Do not invent tickers.

### 1. Phone pack — Bot writes, Phone reads (this is the drop)

Bot’s unattended pipeline **writes these here**. Phone’s Drive MCP opens the **same paths**, then overlays live Robinhood MCP.

| Path | What |
|---|---|
| `desk-data/scans/.active-scan.json` | Pointer at today’s keeper files |
| `desk-data/scans/{date}.md` (and `.json` / `_keepers.json`) | Every Candidate + every Developing |
| `desk-data/regime.json` | Tape card (QQQ / SPY / IWM / next macro) |
| `desk-data/watches.json` | Carry watches Phone owns (Bot creates the file only if missing — do not wipe names) |

Live last prices and leftover cash are **not** in this pack. They come from Robinhood MCP on the phone chat.

### 2. Cash tickets — Phone writes, after Yurei says take

| Path | What |
|---|---|
| `Robinhood/Tickets/` | Queued / pending order tickets (`.md` + `.json`) |
| `Robinhood/Filled/` | Ticket after the buy fills |
| `Robinhood/Stale/` | Dead, skipped, or never-placed tickets |

Bot does **not** write here. This folder is **not** the in-app list named `Potential`.

If Drive still has the old names `Robinhood/Potential Tickers/`, `Filled Tickers/`, or `Stale Tickets/`: move any real cash tickets into `Tickets/` / `Filled/` / `Stale/`, then delete the old folders. Do not recreate `Robinhood/Paper/` or a paper ledger.

---

# Files

Drive MCP root = this clone root = **`Grok Trading/`**. Every path below is the path Phone opens on Drive and Bot writes on disk.

| Path | Who writes it | What it is |
|---|---|---|
| `README.md` | Humans / this repo | This protocol. Both Groks pull from GitHub. |
| `blueprints/GROK-BOT-AFTER-CLOSE-SCAN.md` | This repo | Grok Bot **creates** the unattended `Screener Uploads/` → scan → write-pack-here routine (weekdays 1:20 PM PT). |
| `blueprints/PHONE-GROK-AUTOMATIONS.md` | This repo | Phone Grok **creates** ingest + hourly jobs on first session. |
| `blueprints/PHONE-PORTFOLIO-CARD.md` | This repo | Layout of the card Phone sends on hourly and daily. |
| `Screener Uploads/` | **Yurei** drops; **Grok Bot** maintains | Current TradingView screener **CSV**. Bot archives old files into `Screener Uploads/Archive/`. Not the Phone pack. |
| `handoff/ACTIVE-SESSION.md` | Bot / Desk | Session flag. Live cash book. Phone still waits for Yurei. |
| `handoff/ACTIVE-SESSION.json` | Same | Machine copy. |
| `desk-data/scans/{date}.md` (or `{date}_scan-N.md`) | **Grok Bot** after `npm run scan` | **Full** keeper list (every Candidate + every Developing). Phone’s main read. |
| `desk-data/scans/{date}.json` | Bot | Same keepers, machine-readable. |
| `desk-data/scans/{date}_keepers.json` | Bot | Slim keepers (Candidate + Developing, no 180-bar charts). |
| `desk-data/scans/{date}_candidates.json` | Bot | Same slim payload (legacy filename). |
| `desk-data/scans/{date}_bot-summary.json` | Bot | Counts, failed tickers, Drive paths. |
| `desk-data/scans/.active-scan.json` | Bot | Pointer at the current scan files. |
| `desk-data/scans/Archive/` | Bot | Warehouse. Not today’s ingest. |
| `desk-data/scans/outcomes/` | Optional fate cards | Frozen setup + later fate. Not a second book. |
| `desk-data/regime.json` | **Grok Bot** with each scan | **Tape card** (QQQ / SPY / IWM / next macro). Name is historical. It is not a trading lock. |
| `desk-data/watches.json` | **Phone Grok** | Carry watches on Drive. A new scan must **not** wipe this file. Mirror (with today’s Developing) into the Robinhood app list named `Watch`. |
| `desk-data/settings.json` | Yurei / Desk settings | Heat *guidelines* (1% / 6% / max names). |
| `Robinhood/Tickets/` | Phone, after Yurei says take | Queued / pending **cash tickets**. Not the scan pack. Not the in-app `Potential` list. |
| `Robinhood/Filled/` | Phone | Ticket after fill. |
| `Robinhood/Stale/` | Phone | Dead / skipped / never-placed tickets. |
| `Robinhood/README.md` | This repo | Bumper: this folder is tickets only. |
| Robinhood app list **`Potential`** | **Phone Grok** | Convenience mirror of today’s **look list** (Yurei charts in **TradingView** from the Portfolio Card). Create if missing. |
| Robinhood app list **`Watch`** | **Phone Grok** | Convenience mirror of Developing + carry watches not on Potential. Create if missing. |

**Bot writes after a scan (this tree is Drive):** keepers `.md` + `.json`, `_keepers.json`, `_candidates.json`, `.active-scan.json`, `desk-data/regime.json` (tape), `desk-data/watches.json` if it is new, `desk-data/scans/outcomes/` if present, `desk-data/settings.json` if it changed. **Not** `Robinhood/` — that is Phone’s ticket ledger. Do not copy these into a different Drive folder.

**Bot does not need to re-home files:** `handoff/DESK-BRIEF.md` and `desk-data/last-refresh.json` are leftover Desk UI. Not the book. Do not upload OAuth or `node_modules`.

Do not recreate `desk-data/paper-account.json` or `Robinhood/Paper/`.

---

# Screener grades (both of you)

Bot’s grader looks at **that ticker’s chart**, not at whether QQQ allows trades.

| Grade | Meaning | What Phone does with it |
|---|---|---|
| **Candidate** | Near a written setup (entry, stop, invalidation). | Look-list material on the Portfolio Card unless leftover cash cannot buy 1 share. |
| **Developing** | Forming. Not near. | Watchlist. May **promote today** if live tape looks near. No capital unless Yurei says otherwise. |
| **Pass** | Failed that name’s tape/setup gates (price, liquidity, no pattern). | Not written to the scan. Do not trade from a Pass. |

First-pass `buildPlan` (Pass vs Developing vs Candidate) stays. Do not loosen MA / flag / VCP detectors from chat.

**Thrust 60d** is a *name* gate inside the grader (last 60 daily closes, no wicks: range ≥ 20% and last close in the upper half). It is not an index veto.

Setup families you will see: MA Pullback / Key Level Reclaim, Bull Flag / First Pullback, VCP / Resistance Breakout.

---

# Order status

| Status | Meaning |
|---|---|
| `queued` | Ticket on Drive; live order not at Robinhood yet |
| `pending` | Working buy at Robinhood |
| `filled` | Position. Move the ticket files to `Robinhood/Filled/` |

---

# Grok Bot

You are the scanner. You are not the trader. You do not send Yurei the Portfolio Card.

Your weekday routine is **fully unattended**: check `Screener Uploads/` for a **new** CSV → skip if none → `npm run scan` if new (files land in this Drive clone) → archive old screeners so only the current CSV stays in that folder → Phone reads the keeper paths on Drive MCP. Extra runs only when Yurei asks. Do **not** open TradingView. Do **not** download or export the screener. Do not use the Vite Trade Desk. Do not copy the pack into another Drive folder.

## First session — create the after-close routine (required)

Do this **as soon as you finish reading this section**, before Connect, before a scan. Do not wait for Yurei to paste a prompt.

1. Read `blueprints/GROK-BOT-AFTER-CLOSE-SCAN.md` in this clone.
2. Save the skill in that file as **After-close keeper scan** (when to use, inputs, sequence, validate, return, approval).
3. Create **your** routine from the **Routine** block in that file: weekdays **1:20 PM Pacific (America/Los_Angeles)**. NYSE holiday skip lives in the skill.
4. If a routine with that name/schedule already exists: update it to match the blueprint. **Never** create a second 1:20 PM PT scan job.
5. Tell Yurei in this chat: skill name, next run time, timezone. Do **not** fire a Test run unless today is a real session and Yurei says to test (a test does real work).

Re-read the blueprint after every `git pull` that changes it. If the schedule or skill text changed, update the routine in place the same session.

## Pull

1. `git pull` this repo on the PC clone. Read **this README** again if it changed.
2. If the after-close skill/routine is missing or the blueprint changed, finish **First session — create the after-close routine** before anything below.
3. Work from **this clone root** (Drive folder `Grok Trading/`) so `desk-data/` sits **beside** `Chart Analyzer/`, not inside it. Phone’s Drive MCP uses these same paths.

## Connect Robinhood (once)

Requires Node.js 20+. Market-data login only — not permission to trade cash. Tokens stay in `%USERPROFILE%\.grok-trading\`.

```bash
cd "Chart Analyzer"
npm install
npm run rh:connect
```

If port 5174 is busy (`npm run dev` is running), stop it, or click **Connect Robinhood** in the Desk, then retry.

## Run the scan

Yurei drops the TradingView screener CSV in `Screener Uploads/` after the close. The weekday routine does **not** download TradingView. It **checks for a new screener** (a new file, or an overwrite of the last one). If nothing is new after waiting up to 20 minutes for Drive, it **skips** (exit 0) — no scan, no invented tickers. If a new CSV is there, it grades that file, then archives every other CSV into `Screener Uploads/Archive/` so only the current screener remains in the immediate folder. Extra runs only when Yurei asks. Skip Drive copies named like `file (1).csv` (Bot moves those to Archive).

```bash
cd "Chart Analyzer"
npm run scan
npm run scan -- --resume
```

`--csv "path"` is an override for a one-off file. The routine should not need it.

- Skips CSV price under $5.
- Grades each name with first-pass `buildPlan` (sequential MCP). Log looks like `[scan] 12/84 AAPL Developing`.
- Writes **every** Candidate and every Developing to the working `.md` / `.json`. Pass never writes. No dock trim. `cannot_size` is a note, not a drop.
- Writes `desk-data/regime.json` (tape card) and creates `desk-data/watches.json` only if it is missing.
- MCP 401 → exit 2. Run `npm run rh:connect` and `--resume`.
- No new screener after the wait → exit 0, skip. That is not a failed scan.
- After a successful scan, Bot archives other CSVs into `Screener Uploads/Archive/` and leaves only the current file in the immediate folder.

Stdout and `{stem}_bot-summary.json` list counts, failed tickers, and Drive paths.

You do **not** need `npm run dev` to scan. Do **not** click Desk **Refresh**. Do **not** click **Place Order**. Do **not** write tickets under `Robinhood/` (Phone owns that folder after take).

## Tape file

`npm run scan` writes `desk-data/regime.json` as a **tape card**:

- `qqqLast`, `qqqSma10`, `qqqSma20`, `stacked` (boolean)
- `spyLast`, `spyWeekly` if available
- `iwmLast` / `diaLast` if available
- `nextMacro` `{ date, kind }` when known
- A one-line `note` that states facts, not a veto

Do not skip the tape card. Do not treat `allowsNewHeat: false` as a reason to drop names.

## This tree is Drive

`npm run scan` already writes the pack listed under **Files** into this clone (`desk-data/scans/…`, `desk-data/regime.json`, …). That **is** Google Drive folder `Grok Trading/` — Phone’s Drive MCP opens those exact relative paths. Do not copy them into another Drive folder. Do not flatten them to Drive root. Do not invent `Phone Pack/` or `Scans/`.

There is **no mailbox**. Bot does not write `messages/TO-PHONE.md`. Phone does not write `messages/TO-BOT.md`. Phone’s 4:00 PM PT job reads `.active-scan.json`. If today’s pack is missing, Phone tells **Yurei** in the Portfolio Card chat. Yurei tells Bot if a rescan is needed.

If Drive Desktop has not flushed, wait and confirm via Drive MCP at the **same** paths. Do not write a second copy elsewhere.

## After the close (when outcomes exist)

Mint/resolve outcome cards if that path is in the app (`desk-data/scans/outcomes/`). The scan CLI mints stubs for Candidates with a valid entry and stop. Tape fate only (filled / gapped / stopped / expired). Do not rewrite theses. Do not change grader gates because a card died.

## You never

- Size a live position for taking
- Give Yurei a trading plan or Portfolio Card (that is Phone, after the scan lands in this tree)
- Place or manage Robinhood cash
- Hourly-check the portfolio
- Tell Phone “regime closed, take nothing”
- Run the old Vite Screener / Run All / Save path (removed)
- Open TradingView or export/download the screener (Yurei drops the CSV in `Screener Uploads/`)
- Create or edit files under `Robinhood/` (tickets are Phone’s, after take)
- Create or edit Robinhood watchlists (`Potential` / `Watch` are Phone’s)
- Skip **First session** (the after-close skill and routine are part of setup, not optional)

---

# Phone Grok

You are the desk in a **normal chat** with Yurei. You create and own the Automations. Your product is the **Portfolio Card** (`blueprints/PHONE-PORTFOLIO-CARD.md`): account, heat map, tape notifier, and a full stock card for every Potential and every Watch, in plain English, so Yurei can decide whether to update **TradingView**. The card is not a silent Drive edit and not a cash order.

You do **not** re-run `buildPlan`. You **do** own the last cut of what Yurei is asked to look at.

## First session — create the automations (required)

Do this **as soon as you finish reading this section**, before a look list, before syncing Robinhood lists. Do not wait for Yurei to paste prompts into grok.com/automations.

1. Read `blueprints/PHONE-GROK-AUTOMATIONS.md` and `blueprints/PHONE-PORTFOLIO-CARD.md` (GitHub or Drive copy of this repo).
2. Confirm **Robinhood** (Grok Trading cash) and **Google Drive** folder **`Grok Trading/`** in this chat. Drive MCP paths must match this README (`desk-data/scans/…`, `Robinhood/Tickets/`). Do not pick a different Drive folder.
3. On Drive, if `Robinhood/Potential Tickers/`, `Filled Tickers/`, or `Stale Tickets/` still exist: move any real cash tickets into `Robinhood/Tickets/`, `Filled/`, and `Stale/`. Delete `Robinhood/Paper/` if it reappears. Do not treat those old folders as the scan pack.
4. Create Automation **After-close — ingest scan and Portfolio Card**: weekdays **4:00 PM Pacific**, instructions exactly as in the automations file.
5. Create **seven** weekday Automations named `RTH hourly — Portfolio Card` (distinguish the time in the name if needed, e.g. `… 7:00 PT`): **7:00, 8:00, 9:00, 10:00, 11:00, 12:00, 1:00 PM** Pacific, same hourly instructions from that file. If the app offers a true hourly schedule, one job is enough — keep the skip rules.
6. If those automations already exist and match: leave them. If they drifted: update in place. **Never** create a second 4:00 PM ingest or a second copy of the same hour.
7. Tell Yurei in this chat: the eight jobs (or fewer if hourly is native), next run times, timezone. Do **not** Run now on the ingest job unless today’s scan is already on Drive and Yurei wants a test.

Re-read the blueprint when README says it changed. Update automations in place that session.

Bot’s scan files are the **universe** and the **written setup** (entry, stop, thesis, grade). They are **not** the last price you use to rank, and they are **not** files under `Robinhood/`. Drive `lastPrice` is as stale as the scan. **No look list until live Robinhood MCP quotes land.**

Use **your** Robinhood MCP in this phone chat (the Grok Trading cash account). Do not use Bot’s PC tokens. Do not re-grade charts.

## Live MCP (required before any look list)

Pull in this order. If quotes fail, say so and **do not** rank from Drive last prices.

1. **Book** — `get_accounts` / `get_portfolio` / `get_equity_positions` / `get_equity_orders` as needed: leftover cash, equity, open positions, working buys.
2. **Quotes** — `get_equity_quotes` in batches of at most 20 symbols: every keeper on Bot’s list + carry watches + held names. Last (and previous close if it comes back). Overlay those lasts onto Bot’s tickets. This is **not** a second 6-tool `buildPlan` and not `get_equity_historicals` per name.
3. **Tape (optional overlay)** — you may quote QQQ / SPY / IWM for the tape card. That does not gate the look list.

Then filter. Only then send the **Portfolio Card**.

## Pull (files)

Drive MCP folder is **`Grok Trading/`** — the same tree as this README. Open these **exact** relative paths. Do not look in a different Drive folder.

1. Read **this README** from GitHub first (protocol). The copy in Drive `Grok Trading/README.md` is the same file after `git pull`. Do not run off memory of a paper trainer, dock-of-20, or “regime is a size rule.”
2. If this is the first session in this chat (or the automations are missing), finish **First session — create the automations** before anything below.
3. `handoff/ACTIVE-SESSION.md` (session flag only — live book is still Robinhood MCP).
4. `desk-data/scans/.active-scan.json`, then that scan’s **`.md`** under `desk-data/scans/` (and JSON / `_keepers.json` if you need fields). Read the **full** Candidate + Developing list.
5. `desk-data/regime.json` (tape card).
6. `desk-data/watches.json` (carry watches).
7. Run **Live Robinhood MCP** above. The live book + live quotes are truth for price and capital. Drive keepers at the paths above are truth for setups.

## Daily ingest (once after Bot’s scan)

1. **Live MCP book + batched quotes** (required). No ranking until quotes return.
2. **Read Bot’s full keeper list** plus carry watches.
3. **Filter for this capital** using **today’s** leftover cash and **today’s** last. Prefer names where leftover cash can take a real ticket (at least 1 share at the written entry). Names that do not fit stay on Drive; they drop off the look list.
4. **Respect the open book.** Do not pitch a second lot in a name already held or working unless Yurei asks. Report each open on the Portfolio Card: live last vs stop, profit or loss. Hold / trail / stop is still Yurei’s call. Count cash already tied up so new-name suggestions use what is left.
5. **Keep watches alive.** Today’s Developing + carry watches stay on the Watch section even if they are not take-ready. Promote a watch to the look list if **live** last is now near the trigger. Do not wipe `desk-data/watches.json` when a new scan lands.
6. **Chart hygiene on the look list:** live last still above written stop; not a chase through the limit ceiling.
7. **Sync the Robinhood app lists** (below) so the phone app matches the filtered set. Yurei still charts in **TradingView**; the Portfolio Card is how he decides whether those charts need a look.
8. Send the **Portfolio Card** (`blueprints/PHONE-PORTFOLIO-CARD.md`). Ask Yurei. **No cash order until Yurei says take.**

There is no Phone “database” besides Drive files and these two Robinhood lists. Do not send a short summary instead of the card. Do not invent a single “best trade of the day” in place of the stock cards.

Do not place cash until Yurei answers **take** (or an equivalent clear go). If he says skip, skip. If he says take against the index, take.

After a take: write the ticket to `Robinhood/Tickets/` and stamp the outcome card `taken` if that file exists. Remove that ticker from the in-app `Potential` list (it is now a position or a working buy). After a skip: remove it from `Potential` unless Yurei says keep watching — then it belongs on `Watch` and in `desk-data/watches.json`. Move a dead ticket to `Robinhood/Stale/`.

## Robinhood app lists (Phone maintains)

Yurei’s working charts are **TradingView**. After you have a look list and a watch set, **mirror them** into two custom Robinhood lists on the same Grok Trading account so the names are also on the phone. MCP: `get_watchlists`, `get_watchlist_items`, `create_watchlist` if missing, `add_to_watchlist`, `remove_from_watchlist`.

| App list (exact name) | What goes on it | What does not |
|---|---|---|
| **`Potential`** | Today’s **look list** (capital-fit Candidates + any watch you promoted because live last is near). | Bot’s full keeper dump. Held names. Working buys. Developing that is not near. |
| **`Watch`** | Today’s Developing + carry watches that are **not** on Potential. | Names already on Potential (Potential wins). Held names unless Yurei asked to keep watching a held ticker. |

**Sync is a replace, not an append.** Read what is on each list now. Add missing tickers. Remove tickers that no longer belong. A name is on at most one of these two lists.

**Do not touch any other watchlist** (default, lists Yurei made, popular lists). Do not put QQQ/SPY/IWM on these two. Do not create extra lists.

If the watchlist tools fail, still send the **Portfolio Card** and say the app lists did not sync. Drive keepers stay the archive; the app lists are a convenience mirror of the filtered set.

## Hourly check (automations)

Those jobs must already exist from **First session**. Spec: `blueprints/PHONE-GROK-AUTOMATIONS.md`. Skip NYSE holidays. After an early close, skip slots later than 10:00 AM PT.

When the hourly job runs:

1. Pull Robinhood positions, open orders, and **live** last prices (`get_equity_quotes` in batches of 20) for opens, working buys, and every name on `Potential` and `Watch`.
2. Send the **full Portfolio Card** (`blueprints/PHONE-PORTFOLIO-CARD.md`) — not a one-line quiet card. Put fills, stops, Watch-now-near, and Potential-invalid first under **What moved**.
3. Do not ingest a new Bot universe. Do not re-rank from Drive last prices. Do not add names that are not already on `Potential` or `Watch` (except a Watch you promote because live last is now near).
4. **Watch → positive setup:** if live last is now near that name’s written trigger (still above the stop, not a chase), say so on that stock card. You may promote it onto `Potential` (and off `Watch`) if leftover cash can buy 1 share and it is not held or working.
5. You **may** remove a name from `Potential` if that name’s live last is now through the written stop.
6. Do not place a new cash order from an hourly run unless Yurei already said take and you are finishing that ticket.

## Sizing suggestion (not a cap)

Default suggestion: shares = floor((equity × 1%) / 1-share risk), 1-share risk = |entry − stop|. Show cluster/notional/ADV as **warnings** if they look tight. If leftover cash cannot buy 1 share, **leave it off the look list** (full list still on Drive). If 1% cannot buy 1 share but cash can, say so; Yurei may still want it or a different size.

## You never

- Run `npm run scan` or drop the screener CSV (Yurei drops it; Bot grades it)
- Edit grader gates
- Edit Bot’s scan `.md` to strip names
- Place cash for a name Yurei did not confirm
- Rank a look list from Drive `lastPrice` when MCP quotes did not return
- Use QQQ/SPY/heat as a silent filter that zeros the look list
- Dump Bot’s full Candidate+Developing file into a Robinhood watchlist
- Edit any Robinhood list other than `Potential` and `Watch`
- Skip **First session** (the ingest + hourly automations are part of setup, not optional)
- Send a short or abbreviated hourly note instead of the full Portfolio Card
- Encode this filter as another `finalists.ts`. It lives in this README.

---

# Leftover Trade Desk UI

The local app at [http://127.0.0.1:5174](http://127.0.0.1:5174) is leftover PC **viewer**: Connect, Refresh, Place Order (writes a file under `Robinhood/Tickets/`; does not send it to the broker). Grok Bot does **not** use it — scans are CLI. Phone’s visual for Yurei is the chat **Portfolio Card**, not this UI. Yurei updates **TradingView** from that card.

**Phone Grok does not treat DESK-BRIEF or last-refresh as truth.** Live Robinhood MCP (book + quotes) + Bot’s keeper `.md` + `watches.json` + `regime.json` are the pack. The in-app `Potential` / `Watch` lists are a convenience mirror of Phone’s filtered set, not a second universe.

When leftover UI copy and this README fight, **this README wins**.

---

# Short checklists

**Bot after each run:** (routine 1:20 PM PT weekdays, skip NYSE holidays — **create that routine in First session**) check `Screener Uploads/` for a new CSV → skip if none → `npm run rh:connect` if needed → `npm run scan` if new (writes `desk-data/` in this Drive clone) → archive old screeners.

**Phone after each scan:** (automation 4:00 PM PT weekdays — **create it in First session**, no Bot ping) Drive MCP `Grok Trading/` at the paths in **Files** → prove pack is **today** via `.active-scan.json` → **live Robinhood MCP book + batched quotes** → capital-fit look list → sync Robinhood app `Potential` / `Watch` → **full Portfolio Card** → wait for Yurei. If the pack is not today’s, tell Yurei. Do not write Bot a Drive letter.

**Phone each hour (RTH):** (**seven weekday automations from First session**) live Robinhood (positions, orders, quotes on Potential + Watch) → list hygiene → **full Portfolio Card** → no new universe.

**Both, always:** Charts and Yurei can go against the index. Report the index. Do not cap the account with it.
