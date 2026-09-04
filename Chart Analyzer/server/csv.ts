const SYMBOL_HEADER = /^(symbol|ticker)$/
const TICKER_CELL = /^[A-Z][A-Z0-9.]{0,9}$/

export interface CsvRow {
  ticker: string
  name: string | null
  price: number | null
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let quoted = false
  const src = text.replace(/^\uFEFF/, "")

  const pushRow = () => {
    if (row.some((value) => value.trim())) rows.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const char = src[i]
    if (quoted) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      continue
    }
    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ",") {
      row.push(cell)
      cell = ""
      continue
    }
    if (char === "\n") {
      row.push(cell)
      cell = ""
      pushRow()
      continue
    }
    if (char === "\r") continue
    cell += char
  }

  row.push(cell)
  pushRow()
  return rows
}

function normHeader(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, " ")
}

function asTicker(raw: string) {
  const ticker = raw.trim().toUpperCase().replace(/^\$/, "")
  if (!TICKER_CELL.test(ticker)) return null
  return ticker
}

function asNumber(raw: string | undefined) {
  if (raw === undefined) return null
  const trimmed = String(raw).replace(/[%$,]/g, "").trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

function asText(raw: string | undefined) {
  const value = raw?.trim() ?? ""
  return value ? value : null
}

function findCol(headers: string[], test: (header: string) => boolean) {
  return headers.findIndex(test)
}

function mapColumns(header: string[]) {
  const headers = header.map(normHeader)
  const symbol = findCol(headers, (h) => SYMBOL_HEADER.test(h))
  return {
    symbol: symbol >= 0 ? symbol : 0,
    name: findCol(headers, (h) => h === "description" || h === "name"),
    price: findCol(headers, (h) => h === "price"),
  }
}

function cell(row: string[], index: number) {
  if (index < 0) return undefined
  return row[index]
}

/** CSV price column present and under $5. Do not skip when price is missing. */
export function isCheapCsvPrice(row: CsvRow) {
  return row.price != null && Number.isFinite(row.price) && row.price > 0 && row.price < 5
}

export function rowsFromCsvText(text: string): CsvRow[] {
  const table = parseCsv(text)
  if (table.length < 2) return []
  const cols = mapColumns(table[0])
  const seen = new Set<string>()
  const rows: CsvRow[] = []
  for (const row of table.slice(1)) {
    const ticker = asTicker(cell(row, cols.symbol) ?? "")
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    rows.push({
      ticker,
      name: asText(cell(row, cols.name)),
      price: asNumber(cell(row, cols.price)),
    })
  }
  return rows
}
