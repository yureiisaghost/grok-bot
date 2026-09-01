# Grok Trading — Trade Desk

Personal swing-trading workstation. There is **no database**. State lives as JSON and Markdown on disk.

**This app does not place broker orders.** It grades names, sizes leftover heat against a book, and writes ticket files. Grok on the phone (or Grok Bot) places and monitors live Robinhood orders from those files.

| Who | Where | Job |
|---|---|---|
| **Grok Bot** | This repo, locally | Run Trade Desk, Save scans, Refresh, Place Order, upload the Drive pack |
| **Phone Grok** | Google Drive folder `Grok Trading/` | Read the pack, decide, manage **cash or paper** in chat |

Robinhood OAuth tokens stay on the machine that runs the app (`%USERPROFILE%\.grok-trading\`). They never go to GitHub or Drive.

---

## Run

Requires Node.js 20+.

```bash
cd "Chart Analyzer"
npm install
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). Keep that process running while you scan or Refresh.

Click **Connect Robinhood** once. Market data (quotes, tape, earnings) comes from Robinhood Trading MCP. Paper mode still needs that connection for prices; it does not use Robinhood cash for sizing.

---

## Live vs Paper

The header toggle is the active book. Screener Save and Desk Refresh both size against it.

| | **Live** | **Paper** |
|---|---|---|
| Book | Robinhood cash account | `desk-data/paper-account.json` |
| Screener | 1% / 6% / cash from last Live Refresh | Same rules on paper equity (e.g. $1,500) |
| Place Order | `Robinhood/Potential Tickers/` | `Robinhood/Paper/Potential Tickers/` |
| Fills | Phone Grok places at Robinhood; Refresh syncs | Refresh fills when last trades through the trigger |
| Switching | Paper ledger is kept | Live snapshot is kept |

Paper starting cash is under **Risk rules** (default $5,000). Change it only while the paper book has no positions, pending tickets, or closed trades.

If a Candidate cannot take **1 share** on the active book (1% slot, leftover heat, and cash), Save drops it from the Candidate dock (`cannot size on this book`). Desk Refresh applies the same math again.

---

## Daily flow

1. Set **Live** or **Paper** in the header.
2. **Screener** — drop a TradingView CSV (or type tickers) → Run All → Save keepers.
3. **Desk** → **Refresh** — pull tape + quotes, mark the book, pick leftover heat.
4. **Place Order** on a Potential card. Live = queued for cash. Paper = working on the paper book (not a cash order).
5. Upload the Drive pack (see below).
6. Phone Grok opens `handoff/ACTIVE-SESSION.md` first.

Queued tickets are green. Pending (working buy) is amber. Filled names move to Open positions / Filled Tickers.

---

## Risk rules

Defaults (editable on the Desk):

- **1%** of equity per new name
- **6%** max heat (dollars at risk if stops hit = shares × max(0, last − stop))
- **Max 2** new names
- Cluster 2%, notional 20% of equity / 2% of ADV

Pending paper or live buys reserve heat. Regime (QQQ/SPY) and FOMC/CPI/NFP blackout can block new names.

**Thrust 60d:** last 60 daily closes only (no wicks): `(max − min) / min × 100`. Pass if ≥ 20% **and** last close is in the upper half of that range.

---

## Google Drive pack

Drive folder: **`Grok Trading/`**. Same relative paths as this repo.

After Save, Refresh, Place Order, or switching Live/Paper, Grok Bot uploads from `handoff/GROK-HANDOFF.json`. The Desk also shows **Google Drive pack** at the bottom of the page.

**Phone Grok reads first:** `handoff/ACTIVE-SESSION.md`

That file says `# ACTIVE SESSION: LIVE` or `# ACTIVE SESSION: PAPER`, whether cash orders are allowed, equity, and which ticket folder to use.

| Local / Drive path | What it is |
|---|---|
| `handoff/ACTIVE-SESSION.md` | LIVE vs PAPER — Phone Grok starts here |
| `handoff/ACTIVE-SESSION.json` | Same flag as JSON (`placeCashOrders`) |
| `handoff/DESK-BRIEF.md` | Equity, heat, pick, held, working |
| `handoff/GROK-HANDOFF.json` | Exact upload list for Bot |
| `desk-data/scans/` | Screener keepers + `.active-scan.json` pointer |
| `desk-data/last-refresh.json` | Live desk snapshot |
| `desk-data/last-refresh-paper.json` | Paper snapshot (survives switching to cash) |
| `desk-data/paper-account.json` | Paper ledger |
| `desk-data/account.json` | Short equity/heat for the **current** book |
| `desk-data/settings.json` | Risk rules + Live/Paper |
| `Robinhood/Potential Tickers/` | Live tickets — cash OK |
| `Robinhood/Filled Tickers/` | Live fills |
| `Robinhood/Paper/Potential Tickers/` | Paper tickets — **do not** place in cash |
| `Robinhood/Paper/Filled Tickers/` | Paper fills |

Copy paths as-is. Do not rename. Skip Drive conflict copies such as `.active-scan (1).json`.

### Do not upload

- `%USERPROFILE%\.grok-trading\` (OAuth)
- `Chart Analyzer/node_modules/`, `dist/`, `Temp/`
- `.env`, `.bridge/`

---

## Layout

```
Grok Trading/                  ← clone root = Drive root
  Chart Analyzer/              ← Vite + React app (port 5174)
  desk-data/                   ← scans, snapshots, paper ledger
  Robinhood/                   ← order tickets
  handoff/                     ← Drive pack for Phone Grok
  README.md
```

`desk-data` is next to `Chart Analyzer`, not inside it. Grok Bot must run the app from a clone of this repo so those folders land in the right place.

---

## Screener grades

- **Candidate** — near setup, sized on the active book
- **Developing** — forming; Watchlist on the Desk; no capital yet
- **Pass** — failed tape/setup gates; never written to the Desk list

Save writes `desk-data/scans/{date}_scan-N.md` + `.json` and the pointer `.active-scan.json`. Refresh prefers the Archive warehouse (`*_raw.json`) when it exists.

---

## Order status

| Status | Meaning |
|---|---|
| `queued` | Ticket on disk; live order not at Robinhood yet |
| `pending` | Working buy (live: open RH order; paper: waiting for last ≥ trigger) |
| `filled` | Position; files move to Filled Tickers |

Paper Place Order is **pending** immediately. Refresh fills at `min(last, limit ceiling)` when last is through the entry, and stops out when last ≤ stop.

---

## For Phone Grok

1. Open `handoff/ACTIVE-SESSION.md`.
2. If **PAPER** — do not place Robinhood cash orders. Use `Robinhood/Paper/` only. Trade Desk fills on Refresh.
3. If **LIVE** — place queued tickets from `Robinhood/Potential Tickers/` without changing shares, stop, or entry method unless the ticket is invalid.
4. Then read `handoff/DESK-BRIEF.md` for the pick, heat, and held rules.
