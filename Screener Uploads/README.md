# Screener Uploads

Drop the TradingView screener **CSV** here after the cash close.

TradingView no longer shows the screener to Grok Bot. You export it. Bot’s 1:20 PM PT job **checks this folder**:

- **New CSV** (new file, or you overwrote the last one) → grade it, then archive every other CSV into `Archive/`. Only the current screener stays here.
- **No new CSV** → no scan. Extra Drive copies (`file (1).csv`) still go to `Archive/`.

- Drive path: `Grok Trading/Screener Uploads/` (this folder — same tree as the clone).
- Overwrite is fine. A dated name (`2026-09-08.csv`) is also fine.
- Do not put files in `Archive/` yourself. Bot maintains that.
