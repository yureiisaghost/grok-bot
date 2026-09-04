# Phone Grok — Portfolio Card

This is the **only** visual Phone sends Yurei on the weekday **hourly** runs and on the **4:00 PM PT** ingest (after Robinhood `Potential` / `Watch` are updated). Protocol: GitHub `README.md`. If this file and README fight, README wins.

Yurei uses this card to decide whether to open **TradingView** and update his own charts. You do not trade from this card. You do not place cash until he says take.

Live Robinhood MCP quotes are required before you fill any last price. Drive keepers are the written setup (entry, stop, goals, thesis) at the paths in GitHub `README.md` — Drive folder **`Grok Trading/`**, same relative paths as the clone (`desk-data/scans/…`, `desk-data/watches.json`). Expand every abbreviation into plain English.

---

## Layout (always this order)

1. Title line: **Portfolio Card** · Pacific date and time · Daily ingest **or** Hourly check
2. **What moved** (three to six sentences). Fills, stops, a Potential that died on its own stop, a Watch that is now near the trigger, or “Nothing material changed since the last card; levels below are still the live tape.” This is how Yurei knows whether TradingView needs a look.
3. **Account** — current Grok Trading Robinhood cash book
4. **Heat map** — dollars at risk vs the 6% guideline, not a lock
5. **Tape notifier** — QQQ / SPY / IWM / next macro as **facts**. Forbidden: “regime closed,” “no new heat,” “cannot take names.”
6. **Open positions** (if any) — one short block each: shares, last, average cost, written stop if known, open profit or loss in dollars and percent
7. **Potential — stock cards** — one card per name on the in-app **Potential** list (today’s look list)
8. **Watch — stock cards** — one card per name on the in-app **Watch** list
9. **Ask** (daily ingest only): “Take, skip, or change size. Your TradingView.” Hourly: only ask if something on a card now needs a decision (Watch became near, Potential invalid, fill). Quiet hourly: no extra pitch.

Do not dump Bot’s full keeper file onto this card. Only **Potential** and **Watch** (plus opens). If a list is empty, say so in one sentence and skip empty cards.

---

## Look (clean and modern)

This is a chat card, not a website. Keep it scannable:

- One horizontal rule (`---`) between Account, Heat map, Tape notifier, Opens, Potential, and Watch.
- Section titles in **bold** on their own line. No walls of ticker-shop shorthand.
- Account and heat as a short labeled list, not a paragraph.
- Each stock is its **own** mini-card: ticker heading, then a **Levels** block (numbers only, one line each), then the English setup and plan.
- Do not nest tables inside tables. Do not use emoji as decoration.
- Spell money with a dollar sign and two decimals when the last is that precise.

---

## Account block

Use live MCP. Spell words out.

- Account equity
- Cash available
- Buying power if Robinhood returns it
- Open positions (count and names)
- Working buy orders (count, names, shares, limit or stop-limit trigger)
- Suggested one-percent risk slot in dollars (guideline)

---

## Heat map

Heat is shares × (last minus written stop) when last is above the stop, summed across opens and working buys. Compare to the 6% equity **guideline**.

Draw a simple bar (ten blocks). Example if 40% of the guideline is used:

`Heat ████░░░░░░  $1,200 open + $0 pending  vs  $3,000 guideline (six percent of equity)`

Also print leftover heat and the one-percent slot. Then one plain sentence: leftover heat is a guideline, not a closed sign.

---

## Tape notifier

From `desk-data/regime.json` plus a live QQQ/SPY/IWM quote if you already have it:

- Nasdaq-100 (QQQ): last, 10-session average, 20-session average, whether the 10 is above the 20 (stacked or not stacked)
- S&P 500 (SPY): last, weekly stage if known (up, down, or sideways)
- Russell 2000 (IWM): last
- Next scheduled Federal Reserve decision, consumer-price report, or jobs report if on file

Close with: “Tape is color for your TradingView. It does not veto a name whose own chart still works.”

---

## Stock card (Potential and Watch use the same body)

Label the section **Potential** or **Watch**. Then for each ticker, a separate card with a rule above it:

**{TICKER} — {company name in full}**  
*Potential* or *Watch*

**Levels** (numbers from the Drive ticket, live last from Robinhood this run):

- **Live last:** $…
- **Entry:** $… (written trigger)
- **Stop loss:** $…
- **First goal / one times the risk:** $…
- **Second goal / two times the risk:** $…
- **Third goal / three times the risk:** $…

Then the English (full sentences, no shorthand):

- **Setup:** full family name (moving-average pullback / key-level reclaim, bull flag / first pullback after an impulse, or volatility-contraction / resistance breakout). Then four to eight sentences: why this chart is that setup, in human English. Expand moving average, relative volume, average true range, volatility contraction.
- **How you would enter:** complete sentences (buy stop-limit, trigger, limit ceiling). Not “BSL @ 12.10.”
- **Invalidation:** where the idea is wrong, in dollars and in words (same stop as Levels).
- **Plan of attack:** the Drive `plan` and `thesis` rewritten as full paragraphs. If the file is terse, expand it. Never leave “MA PB, 1R, trim.”
- **Vs the live tape:** last versus entry, last versus stop, last versus first goal. One or two sentences so Yurei knows whether TradingView is stale.
- **Suggested size (Potential only, guideline):** shares at one percent of equity, dollar risk, notional. Watch cards: “No capital unless you say so.”

If a number is missing on Drive, write “not on the ticket” — do not invent goals.

Order Potential cards by quality then closeness to the trigger. Order Watch the same. Watch names get the same Levels + English body as Potential.

---

## English rules

- No unexplained abbreviations: not RTH, BSL, MA, VCP, ATR, ADV, 1R as the only label.
- You may put “(one R)” after “first goal.”
- Forbidden tape language still applies on this card.
- Do not tell Yurei he cannot trade because heat or QQQ.
