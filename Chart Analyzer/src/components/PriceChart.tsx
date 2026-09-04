import { useEffect, useRef } from "react"
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
} from "lightweight-charts"
import type { AutoscaleInfo, Time } from "lightweight-charts"
import type { ChartGeometry, PlanOfAttack } from "../types"
import { SetupBoxPrimitive } from "./SetupBoxPrimitive"

type Day = `${number}-${number}-${number}`

const EMPTY_GEO: ChartGeometry = {
  box: null,
  markers: [],
  caption: null,
  pctToLevel: null,
  atrToLevel: null,
  levelLabel: null,
}

function asDay(value: string): Day {
  return value.slice(0, 10) as Day
}

function emptyGeometry(plan: PlanOfAttack): ChartGeometry {
  return plan.geometry ?? EMPTY_GEO
}

export function PriceChart({ plan }: { plan: PlanOfAttack }) {
  const ref = useRef<HTMLDivElement>(null)
  const geometry = emptyGeometry(plan)

  useEffect(() => {
    const el = ref.current
    if (!el || !plan.chart?.length) return

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: "#0b0f14" },
        textColor: "#8a97a5",
        fontFamily: "IBM Plex Sans, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)", rightOffset: 6, minBarSpacing: 6 },
      width: el.clientWidth,
      height: el.clientHeight,
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#3ecf8e",
      downColor: "#f07178",
      borderVisible: false,
      wickUpColor: "#3ecf8e",
      wickDownColor: "#f07178",
    })
    const ema20 = chart.addSeries(LineSeries, {
      color: "#5ec8e6",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    const ema50 = chart.addSeries(LineSeries, {
      color: "#e6b84c",
      lineWidth: 2,
      lastValueVisible: true,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    })
    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceLineVisible: false,
      lastValueVisible: false,
    }, 1)

    candles.setData(plan.chart.map((bar) => ({
      time: asDay(bar.time),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    })))
    ema20.setData(plan.chart.flatMap((bar, i) => {
      const v = plan.ema20Series[i]
      return v === null || v === undefined ? [] : [{ time: asDay(bar.time), value: v }]
    }))
    ema50.setData(plan.chart.flatMap((bar, i) => {
      const v = plan.ema50Series[i]
      return v === null || v === undefined ? [] : [{ time: asDay(bar.time), value: v }]
    }))
    volume.setData(plan.chart.map((bar) => ({
      time: asDay(bar.time),
      value: bar.volume,
      color: bar.close >= bar.open ? "rgba(62, 207, 142, 0.42)" : "rgba(240, 113, 120, 0.42)",
    })))

    const panes = chart.panes()
    if (panes[0]) panes[0].setStretchFactor(1)
    if (panes[1]) panes[1].setStretchFactor(0.22)

    const entry = plan.entryPrice ?? null
    const stop = plan.stopPrice ?? null
    const pivot = plan.pivot ?? null
    const r1 = plan.r1 ?? null
    const r2 = plan.r2 ?? null

    if (entry !== null) {
      candles.createPriceLine({
        price: entry,
        color: "#3ecf8e",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "Entry",
        axisLabelColor: "#3ecf8e",
        axisLabelTextColor: "#042015",
      })
    } else if (pivot !== null) {
      candles.createPriceLine({
        price: pivot,
        color: "#5ec8e6",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "Pivot",
        axisLabelColor: "#5ec8e6",
        axisLabelTextColor: "#0b0f14",
      })
    }
    if (stop !== null) {
      candles.createPriceLine({
        price: stop,
        color: "#f07178",
        lineWidth: 2,
        lineStyle: LineStyle.Solid,
        axisLabelVisible: true,
        title: "Stop",
        axisLabelColor: "#f07178",
        axisLabelTextColor: "#1a0a0c",
      })
    }
    if (r1 !== null) {
      candles.createPriceLine({
        price: r1,
        color: "#e6b84c",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: "R1",
        axisLabelColor: "#e6b84c",
        axisLabelTextColor: "#1a1404",
      })
    }
    if (r2 !== null) {
      candles.createPriceLine({
        price: r2,
        color: "rgba(230, 184, 76, 0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.SparseDotted,
        axisLabelVisible: true,
        title: "R2",
        axisLabelColor: "rgba(230, 184, 76, 0.7)",
        axisLabelTextColor: "#1a1404",
      })
    }

    const knownTimes = new Set(plan.chart.map((bar) => asDay(bar.time)))
    const markers = (geometry.markers ?? []).filter((marker) => knownTimes.has(asDay(marker.time)))
    if (markers.length) {
      createSeriesMarkers(candles, markers.map((marker) => ({
        time: asDay(marker.time) as Time,
        position: marker.position,
        shape: marker.shape,
        color: marker.color,
        text: marker.text,
        size: 1,
      })))
    }

    if (geometry.box) candles.attachPrimitive(new SetupBoxPrimitive(geometry.box))

    const ticketPrices = [entry, stop, geometry.box?.high ?? null, geometry.box?.low ?? null]
      .filter((n): n is number => n !== null && Number.isFinite(n))
    if (ticketPrices.length >= 2) {
      candles.applyOptions({
        autoscaleInfoProvider: (original: () => AutoscaleInfo | null) => {
          const base = original()
          const minValue = Math.min(base?.priceRange?.minValue ?? ticketPrices[0], ...ticketPrices)
          const maxValue = Math.max(base?.priceRange?.maxValue ?? ticketPrices[0], ...ticketPrices)
          const pad = Math.max((maxValue - minValue) * 0.04, 0)
          return { priceRange: { minValue: minValue - pad, maxValue: maxValue + pad } }
        },
      })
    }

    chart.timeScale().fitContent()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: el.clientWidth, height: el.clientHeight })
    })
    ro.observe(el)

    return () => {
      ro.disconnect()
      chart.remove()
    }
  }, [plan])

  const legend = [
    { className: "lg-ema20", label: "20 EMA" },
    { className: "lg-ema50", label: "50 EMA" },
    plan.entryPrice != null ? { className: "lg-entry", label: "Entry" } : plan.pivot != null ? { className: "lg-pivot", label: "Pivot" } : null,
    plan.stopPrice != null ? { className: "lg-stop", label: "Stop" } : null,
    plan.r1 != null ? { className: "lg-r", label: "R1" } : null,
  ].filter((item): item is { className: string; label: string } => Boolean(item))

  if (!plan.chart?.length) {
    return (
      <div className="chart-wrap">
        <div className="chart-box chart-empty">
          {plan.heldChart
            ? "No daily bars yet for this position. Click Refresh, then open the card again."
            : "No daily bars stored for this name. Re-run npm run scan, then open the card again."}
        </div>
      </div>
    )
  }

  return (
    <div className="chart-wrap">
      <div className="chart-box" ref={ref} />
      {geometry.caption && <div className="chart-caption">{geometry.caption}</div>}
      <div className="chart-legend">
        {legend.map((item) => (
          <span className={item.className} key={item.label}>{item.label}</span>
        ))}
      </div>
    </div>
  )
}
