import type { ScanRow } from "../types"
import { mergeScanRows, queuedRow } from "./scan"

const SYMBOL_HEADER = /^(symbol|ticker)$/
const TICKER_CELL = /^[A-Z][A-Z0-9.]{0,9}$/

export function isScreenerCsv(file: File) {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return true
  const type = file.type.toLowerCase()
  return type === "text/csv" || type === "application/csv"
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
    change1d: findCol(headers, (h) => (h.includes("price change") && h.includes("1 day")) || h === "change %" || h === "chg %"),
    perf1w: findCol(headers, (h) => h.includes("performance") && h.includes("1 week")),
    perf1m: findCol(headers, (h) => h.includes("performance") && h.includes("1 month")),
    vol1w: findCol(headers, (h) => h.includes("volatility") && h.includes("1 week")),
    vol1m: findCol(headers, (h) => h.includes("volatility") && h.includes("1 month")),
  }
}

function cell(row: string[], index: number) {
  if (index < 0) return undefined
  return row[index]
}

export function rowsFromCsvText(text: string, source: string): ScanRow[] {
  const table = parseCsv(text)
  if (table.length < 2) return []
  const cols = mapColumns(table[0])
  const seen = new Set<string>()
  const rows: ScanRow[] = []
  for (const row of table.slice(1)) {
    const ticker = asTicker(cell(row, cols.symbol) ?? "")
    if (!ticker || seen.has(ticker)) continue
    seen.add(ticker)
    rows.push(queuedRow({
      ticker,
      name: asText(cell(row, cols.name)),
      price: asNumber(cell(row, cols.price)),
      change1d: asNumber(cell(row, cols.change1d)),
      perf1w: asNumber(cell(row, cols.perf1w)),
      perf1m: asNumber(cell(row, cols.perf1m)),
      vol1w: asNumber(cell(row, cols.vol1w)),
      vol1m: asNumber(cell(row, cols.vol1m)),
      source,
    }))
  }
  return rows
}

export function tickersFromCsvText(text: string): string[] {
  return rowsFromCsvText(text, "csv").map((row) => row.ticker)
}

export async function readScreenerFiles(files: File[]) {
  const names: string[] = []
  let rows: ScanRow[] = []
  for (const file of files) {
    const found = rowsFromCsvText(await file.text(), file.name)
    if (!found.length) {
      throw new Error(`No Symbol column tickers found in ${file.name}. Export the TradingView screener as CSV.`)
    }
    names.push(file.name)
    rows = mergeScanRows(rows, found)
  }
  return { rows, files: names }
}
