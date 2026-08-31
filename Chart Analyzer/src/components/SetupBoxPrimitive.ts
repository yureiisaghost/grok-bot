import type {
  AutoscaleInfo,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from "lightweight-charts"
import type { ChartBox } from "../types"

interface BoxLayout {
  x1: number
  x2: number
  y1: number
  y2: number
  label: string
}

class BoxRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly layout: BoxLayout | null) {}

  draw(target: Parameters<IPrimitivePaneRenderer["draw"]>[0]) {
    const layout = this.layout
    if (!layout) return

    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const left = Math.min(layout.x1, layout.x2) * scope.horizontalPixelRatio
      const right = Math.max(layout.x1, layout.x2) * scope.horizontalPixelRatio
      const top = Math.min(layout.y1, layout.y2) * scope.verticalPixelRatio
      const bottom = Math.max(layout.y1, layout.y2) * scope.verticalPixelRatio
      const width = Math.max(1, right - left)
      const height = Math.max(1, bottom - top)
      ctx.fillStyle = "rgba(94, 200, 230, 0.11)"
      ctx.strokeStyle = "rgba(94, 200, 230, 0.5)"
      ctx.lineWidth = Math.max(1, Math.round(scope.horizontalPixelRatio))
      ctx.fillRect(left, top, width, height)
      ctx.strokeRect(left, top, width, height)
    })

    target.useMediaCoordinateSpace((scope) => {
      const ctx = scope.context
      const left = Math.min(layout.x1, layout.x2)
      const top = Math.min(layout.y1, layout.y2)
      ctx.font = "600 11px IBM Plex Sans, system-ui, sans-serif"
      ctx.fillStyle = "rgba(168, 220, 236, 0.95)"
      ctx.fillText(layout.label, left + 6, top + 14)
    })
  }
}

class BoxPaneView implements IPrimitivePaneView {
  private layout: BoxLayout | null = null

  set(layout: BoxLayout | null) {
    this.layout = layout
  }

  zOrder() {
    return "bottom" as const
  }

  renderer() {
    return new BoxRenderer(this.layout)
  }
}

export class SetupBoxPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null
  private series: ISeriesApi<SeriesType, Time> | null = null
  private readonly view = new BoxPaneView()
  private readonly views = [this.view]

  constructor(private readonly box: ChartBox | null) {}

  attached(param: SeriesAttachedParameter<Time>) {
    this.chart = param.chart
    this.series = param.series as ISeriesApi<SeriesType, Time>
  }

  detached() {
    this.chart = null
    this.series = null
  }

  updateAllViews() {
    if (!this.chart || !this.series || !this.box) {
      this.view.set(null)
      return
    }
    const c1 = this.chart.timeScale().timeToCoordinate(this.box.from as Time)
    const c2 = this.chart.timeScale().timeToCoordinate(this.box.to as Time)
    const y1 = this.series.priceToCoordinate(this.box.high)
    const y2 = this.series.priceToCoordinate(this.box.low)
    if (c1 === null || c2 === null || y1 === null || y2 === null) {
      this.view.set(null)
      return
    }
    let x1: number = c1
    let x2: number = c2
    const spacing = this.chart.timeScale().options().barSpacing
    if (Math.abs(x2 - x1) < 4) {
      x1 -= spacing / 2
      x2 += spacing / 2
    }
    this.view.set({ x1, x2, y1, y2, label: this.box.label })
  }

  paneViews() {
    return this.views
  }

  autoscaleInfo(): AutoscaleInfo | null {
    if (!this.box) return null
    return {
      priceRange: {
        minValue: this.box.low,
        maxValue: this.box.high,
      },
    }
  }
}
