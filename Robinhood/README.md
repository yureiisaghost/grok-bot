# Robinhood/ — cash tickets only

This folder is **not** the Bot → Phone pack. Grok Bot does not upload scans here.

| Folder | Who writes | What |
|---|---|---|
| `Tickets/` | Phone, after Yurei says **take** | Queued / pending order tickets (`.md` + `.json`) |
| `Filled/` | Phone (or leftover Desk sync) | Ticket after the buy fills |
| `Stale/` | Phone | Dead, skipped, or never-placed tickets |

The pack Phone reads for the **Portfolio Card** lives under `desk-data/scans/`, `desk-data/regime.json`, `desk-data/watches.json`, and `messages/TO-PHONE.md` in Drive folder **`Grok Trading/`** (this clone). Live prices and the cash book come from Robinhood MCP, not from these files.

The in-app lists named **Potential** and **Watch** are not folders in here.

Ignore `Paper/`, `Potential Tickers/`, `Filled Tickers/`, and `Stale Tickets/` if they still exist — old names.
