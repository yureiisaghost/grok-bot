import fs from "node:fs"
import type { OhlcvBar } from "../src/types"
import { REGIME_FILE, WATCHES_FILE, ensureDeskDirs } from "./deskPaths"
import { nowPtStamp, todayPtIso } from "./http"
import { last, sma } from "./indicators"
import { nextMacro } from "./macro"
import { fetchDeskQuotes, fetchDeskTape } from "./rhMcp"
import { weeklyStageFrom } from "./template"

export interface TapeCard {
  kind: "market-tape"
  generatedAt: string
  qqqLast: number | null
  qqqSma10: number | null
  qqqSma20: number | null
  stacked: boolean | null
  spyLast: number | null
  spyWeekly: "up" | "down" | "sideways" | null
  iwmLast: number | null
  diaLast: number | null
  nextMacro: { date: string; kind: string; name: string } | null
  note: string
}

function lastClose(bars: OhlcvBar[]) {
  const close = bars[bars.length - 1]?.close
  return close != null && Number.isFinite(close) && close > 0 ? close : null
}

export async function writeTapeCard(): Promise<TapeCard> {
  ensureDeskDirs()
  const today = todayPtIso()
  const tape = await fetchDeskTape()
  const quotes = await fetchDeskQuotes(["QQQ", "SPY", "IWM", "DIA"])
  const qqqCloses = tape.qqqDaily.map((bar) => bar.close)
  const sma10 = last(sma(qqqCloses, 10))
  const sma20 = last(sma(qqqCloses, 20))
  const stacked = sma10 != null && sma20 != null ? sma10 > sma20 : null
  const next = nextMacro(today)
  const card: TapeCard = {
    kind: "market-tape",
    generatedAt: nowPtStamp(),
    qqqLast: quotes.get("QQQ")?.last ?? lastClose(tape.qqqDaily),
    qqqSma10: sma10,
    qqqSma20: sma20,
    stacked,
    spyLast: quotes.get("SPY")?.last ?? null,
    spyWeekly: tape.spyWeekly.length ? weeklyStageFrom(tape.spyWeekly) : null,
    iwmLast: quotes.get("IWM")?.last ?? null,
    diaLast: quotes.get("DIA")?.last ?? null,
    nextMacro: next ? { date: next.date, kind: next.kind, name: next.name } : null,
    note: "Tape facts only. Not a trading lock. Phone Grok filters the keeper list against the live Robinhood book. Yurei says take or skip.",
  }
  fs.writeFileSync(REGIME_FILE, JSON.stringify(card, null, 2), "utf8")
  return card
}

export function ensureWatchesFile() {
  ensureDeskDirs()
  if (fs.existsSync(WATCHES_FILE)) return
  fs.writeFileSync(WATCHES_FILE, JSON.stringify({
    schema: "grok-trading-watches/v1",
    tickers: [] as string[],
    notes: "Phone Grok writes names Yurei asked to keep watching. A new scan must not wipe this file.",
    updatedAt: nowPtStamp(),
  }, null, 2), "utf8")
}
