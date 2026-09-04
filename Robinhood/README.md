# Robinhood/ — cash tickets only

This folder is **not** the Bot → Phone pack. Grok Bot does not upload scans here.

| Folder | Who writes | What |
|---|---|---|
| `Tickets/` | Phone, after Yurei says **take** | Queued / pending order tickets (`.md` + `.json`) |
| `Filled/` | Phone (or leftover Desk sync) | Ticket after the buy fills |
| `Stale/` | Phone | Dead, skipped, or never-placed tickets |

The pack Phone reads for the **Portfolio Card** lives under `desk-data/scans/`, `desk-data/regime.json`, and `desk-data/watches.json` in Drive folder **`Grok Trading/`**. Bot uploads those from **Bot’s machine**. Live prices and the cash book come from Robinhood MCP, not from these files.

The in-app lists named **Potential** and **Watch** are not folders in here.

If Drive still has `Potential Tickers/`, `Filled Tickers/`, or `Stale Tickets/`, migrate real cash tickets then delete those folders. Do not recreate `Paper/`.
