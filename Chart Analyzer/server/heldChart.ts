import type { DeskPosition, OhlcvBar, PlanOfAttack } from "../src/types"
import { atr, ema, last, pct, roundPx, sma } from "./indicators"

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n)
}

function trend20(closes: number[]): PlanOfAttack["weeklyTrend"] {
  if (closes.length < 20) return "sideways"
  const recent = closes[closes.length - 1]
  const ago = closes[closes.length - 20]
  if (!(ago > 0)) return "sideways"
  const change = (recent - ago) / ago
  if (change > 0.02) return "up"
  if (change < -0.02) return "down"
  return "sideways"
}

/** Chart-only plan for a held name that is not a keeper. Does not run detectors. */
export function buildHeldChartPlan(pos: DeskPosition, bars: OhlcvBar[]): PlanOfAttack {
  const chart = bars.slice(-180)
  const closes = chart.map((bar) => bar.close)
  const highs = chart.map((bar) => bar.high)
  const lows = chart.map((bar) => bar.low)
  const ema20Series = ema(closes, 20)
  const ema50Series = ema(closes, 50)
  const lastPx = pos.lastPrice ?? last(closes) ?? pos.avgCost ?? 0
  const prev = chart.length >= 2 ? chart[chart.length - 2].close : lastPx
  const entry = pos.avgCost ?? null
  const stop = pos.stopPrice ?? null
  const risk = finite(entry) && finite(stop) && entry > stop ? entry - stop : null
  const r1 = finite(risk) && finite(entry) ? roundPx(entry + risk) : pos.nextRPrice ?? null
  const r2 = finite(risk) && finite(entry) ? roundPx(entry + 2 * risk) : null
  const r3 = finite(risk) && finite(entry) ? roundPx(entry + 3 * risk) : null
  const next = pos.nextRPrice ?? r1
  const atr14 = last(atr(highs, lows, closes, 14))
  const stopPct = finite(entry) && finite(risk) && entry > 0 ? (risk / entry) * 100 : null
  const target = next ?? r1
  const pctToLevel = finite(lastPx) && finite(target) && lastPx > 0
    ? ((target - lastPx) / lastPx) * 100
    : null
  return {
    ticker: pos.ticker.toUpperCase(),
    name: pos.ticker.toUpperCase(),
    grade: "Developing",
    score: 0,
    setupType: "Open position",
    lastPrice: lastPx,
    previousClose: prev,
    changePct: prev > 0 ? pct(prev, lastPx) : 0,
    weeklyTrend: trend20(closes),
    readiness: "none",
    oneShareRisk: finite(risk) ? roundPx(risk) : null,
    earnDays: pos.earnDays ?? null,
    entryMethod: "Already in the book",
    entryTrigger: "Position is open.",
    invalidation: finite(stop) ? `Working stop ${stop.toFixed(2)}.` : "No working stop on file.",
    stop: finite(stop) ? `${stop.toFixed(2)} (working order)` : "No working stop on file.",
    thesis: pos.nextRule ?? "Open position. Daily bars only.",
    plan: pos.nextRule ?? "Working stop from the book. Chart is daily bars. Detectors were not re-run.",
    earnings: pos.earnDate ? `Next report ${pos.earnDate}${pos.earnDays != null ? ` (${pos.earnDays}d)` : ""}.` : "",
    warnings: [],
    entryPrice: entry,
    stopPrice: stop,
    pivot: entry,
    r1,
    r2,
    r3,
    levels: {
      ema20: last(ema20Series),
      ema50: last(ema50Series),
      sma50: last(sma(closes, 50)),
      sma150: last(sma(closes, 150)),
      sma200: last(sma(closes, 200)),
      rsi14: null,
      atr14,
      adrPct: null,
      high52: highs.length ? Math.max(...highs) : null,
      low52: lows.length ? Math.min(...lows) : null,
      avgVolume: last(sma(chart.map((bar) => bar.volume), 50)),
      relativeVolume: null,
    },
    sizing: {
      equity: null,
      shares: pos.quantity,
      dollarRisk: finite(risk) ? roundPx(risk * pos.quantity) : null,
      note: "Held size from the book.",
    },
    geometry: {
      box: null,
      markers: [],
      caption: "Open position · daily bars · detectors not re-run",
      pctToLevel,
      atrToLevel: finite(atr14) && atr14 > 0 && finite(target) ? (target - lastPx) / atr14 : null,
      levelLabel: "Next R",
    },
    chart,
    ema20Series,
    ema50Series,
    analyzedAt: new Date().toISOString(),
    heldChart: true,
    stopPct: stopPct ?? undefined,
    stopAtrMultiple: finite(risk) && finite(atr14) && atr14 > 0 ? risk / atr14 : undefined,
  }
}
