# Screener Uploads

Drop the TradingView screener **CSV** here (Drive folder `Grok Trading/Screener Uploads/`) after the cash close.

Grok Bot does **not** read this off Yurei’s PC. Bot pulls this folder via Drive MCP onto **Bot’s machine**, grades a new file, then pushes the maintained folder back.

- **New CSV** (new file, or overwrite of the last one) → Bot scans, then archives every other CSV into `Archive/`. Only the current screener stays here.
- **No new CSV** → no scan.
- Overwrite is fine. A dated name (`2026-09-08.csv`) is also fine.
- Skip Drive copies named like `file (1).csv`.
