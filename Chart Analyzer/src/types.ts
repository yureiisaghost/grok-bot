export type Grade = "Candidate" | "Developing" | "Pass"

export type Readiness = "near" | "needs_close" | "forming" | "none"

export type ScanStatus = "queued" | "running" | "graded" | "failed" | "skipped"

export interface ScanRow {
  ticker: string
  name: string | null
  price: number | null
  change1d: number | null
  perf1w: number | null
  perf1m: number | null
  vol1w: number | null
  vol1m: number | null
  source: string
  status: ScanStatus
  grade: Grade | null
  score: number | null
  setupType: string | null
  failReason: string | null
}

export type SetupFamily =
  | "MA Pullback / Key Level Reclaim"
  | "Bull Flag / First Pullback after Impulse"
  | "VCP / Resistance Breakout"
  | "None"

export interface OhlcvBar {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface PlanLevels {
  ema20: number | null
  ema50: number | null
  sma50: number | null
  sma150: number | null
  sma200: number | null
  rsi14: number | null
  atr14: number | null
  adrPct: number | null
  high52: number | null
  low52: number | null
  avgVolume: number | null
  relativeVolume: number | null
}

export interface PlanSizing {
  equity: number | null
  shares: number | null
  dollarRisk: number | null
  note: string
}

export interface ChartBox {
  from: string
  to: string
  high: number
  low: number
  label: string
}

export interface ChartMarker {
  time: string
  position: "aboveBar" | "belowBar"
  shape: "arrowUp" | "arrowDown" | "circle"
  text: string
  color: string
}

export interface ChartGeometry {
  box: ChartBox | null
  markers: ChartMarker[]
  caption: string | null
  pctToLevel: number | null
  atrToLevel: number | null
  levelLabel: string | null
}

export interface PlanOfAttack {
  ticker: string
  name: string
  grade: Grade
  score: number
  setupType: string
  lastPrice: number
  previousClose: number
  changePct: number
  weeklyTrend: "up" | "down" | "sideways"
  readiness: Readiness
  oneShareRisk: number | null
  earnDays: number | null
  entryMethod: string
  entryTrigger: string
  invalidation: string
  stop: string
  thesis: string
  plan: string
  earnings: string
  warnings: string[]
  entryPrice: number | null
  stopPrice: number | null
  pivot: number | null
  r1: number | null
  r2: number | null
  r3: number | null
  levels: PlanLevels
  sizing: PlanSizing
  geometry: ChartGeometry
  chart: OhlcvBar[]
  ema20Series: Array<number | null>
  ema50Series: Array<number | null>
  analyzedAt: string
  qualityScore?: number
  failedGates?: string[]
  priorThrust60d?: number
  stopAtrMultiple?: number
  stopPct?: number
  flagRetracePct?: number
  sizeableNow?: boolean
  plannedSharesAtRoom?: number
  dollarAdv?: number
  rsSlope20?: number
  rsRaw?: number | null
  scanRs?: number | null
  spyBeat?: boolean | null
  sector?: string | null
  industry?: string | null
  heldChart?: boolean
}

export type BookMode = "live" | "paper"

export interface AppStatus {
  source: string
  connected: boolean
  authUrl: string | null
  message: string
  queue: QueueStatus
  book: {
    bookMode: BookMode
    label: "LIVE" | "PAPER"
    placeCashOrders: boolean
    equity: number | null
    cash: number | null
    remainingHeat: number | null
    perNameRisk: number | null
  }
}

export interface QueueStatus {
  path: string
  fileName: string | null
  scan: number | null
  day: string | null
  tickerCount: number
  tickers: string[]
  updatedAt: string | null
  rawCount: number | null
  finalistCount: number | null
}

export interface ClearResult {
  archivedTo: string | null
  tickerCount: number
}

export interface DeskSettings {
  riskPct: number
  maxHeatPct: number
  maxNewNames: number
  bookMode: BookMode
  paperStartingCash: number
}

export interface DeskPosition {
  ticker: string
  quantity: number
  avgCost: number | null
  lastPrice: number | null
  marketValue: number | null
  dollarHeat: number | null
  heatNote: string
  clusterTag?: string | null
  earnDays?: number | null
  earnDate?: string | null
  trailKind?: "ema20" | "sma10" | null
  trailPx?: number | null
  rMultiple?: number | null
  fillDate?: string | null
  sessionsHeld?: number | null
  nextRule?: string | null
  stopPrice?: number | null
  nextRPrice?: number | null
  openPnl?: number | null
}

export interface DeskPick {
  ticker: string
  name: string
  setupType: string
  grade: Grade
  shares: number
  dollarRisk: number
  notional: number
  notionalPct: number | null
  entryPrice: number
  stopPrice: number
  r1: number | null
  lastPrice: number
  qualityScore: number
  roomToR1: number | null
  why: string
  thesis: string
  entryMethod: string
  limitCeiling: number | null
  stopKind: string
  clusterTag?: string | null
  clusterUsed?: number | null
  orderStatus?: "queued" | "pending"
  brokerState?: string | null
  /** False when the card is review-only (tape parked or leftover heat cannot take it). */
  actionable?: boolean
}

export type RegimeStatus = "open" | "closed" | "pressure" | "unknown" | "blackout"

export type MacroKind = "FOMC" | "CPI" | "NFP"

export interface DeskMacroEvent {
  date: string
  kind: MacroKind
  name: string
  session?: "event" | "prior"
}

export interface DeskRegime {
  status: RegimeStatus
  allowsNewHeat: boolean
  qqqSma10: number | null
  qqqSma20: number | null
  spyWeekly: "up" | "down" | "sideways" | null
  distributionDays: number
  reason: string
  nextMacro?: DeskMacroEvent | null
  macroHit?: DeskMacroEvent | null
}

export interface DeskWatch {
  ticker: string
  name: string
  setupType: string
  grade: Grade
  lastPrice: number
  qualityScore: number | null
  note: string
  entryPrice?: number | null
  stopPrice?: number | null
  r1?: number | null
}

export interface DeskSkip {
  ticker: string
  reason: string
}

export interface DeskScanInfo {
  fileName: string | null
  day: string | null
  scan: number | null
  scanId: string | null
  keeperCount: number
  finalistCount: number
  updatedAt: string | null
  signature: string | null
}

export interface DeskBook {
  bookMode?: BookMode
  equity: number
  cash: number
  buyingPower: number | null
  openHeat: number
  pendingHeat?: number
  remainingHeat: number
  maxHeat: number
  perNameRisk: number
  accountNumber: string | null
}

export interface DeskSnapshot {
  refreshedAt: string
  bookMode?: BookMode
  usedNewList: boolean
  scan: DeskScanInfo | null
  regime: DeskRegime | null
  book: DeskBook
  positions: DeskPosition[]
  pick: DeskPick | null
  runnerUp: DeskPick | null
  working?: DeskPick[]
  filledFromQueue?: string[]
  nextUp: DeskWatch[]
  skipped: DeskSkip[]
  skippedCount: number
  nothingReason: string | null
  nothingStep: number | null
  heldCharts?: Record<string, OhlcvBar[]>
}

export interface DeskState {
  settings: DeskSettings
  snapshot: DeskSnapshot | null
  queuedTickers?: string[]
}

export type PotentialOrderRole = "pick" | "runner"

export type HandoffStatus = "queued" | "pending" | "filled"

export interface PlaceOrderResult {
  ticker: string
  role: PotentialOrderRole
  bookMode: BookMode
  path: string
  driveFolder: string
  jsonFile: string
  mdFile: string
  queuedAt: string
}

export interface HandoffUpload {
  local: string
  drive: string
  kind: string
  bookMode?: BookMode
  required: boolean
}

export interface DriveFolderGuide {
  drive: string
  kind: string
}

export interface HandoffManifest {
  schema: "grok-trading-handoff/v1"
  generatedAt: string
  reason: "save" | "refresh" | "place-order" | "settings"
  bookMode: BookMode
  driveRoot: "Grok Trading"
  instruction: string
  phoneGrok: {
    readFirst: string
    active: BookMode
    placeCashOrders: boolean
    doNotPlaceCashIfPaper: boolean
  }
  neverUpload: string[]
  folders: DriveFolderGuide[]
  uploads: HandoffUpload[]
}

export type OutcomeState = "waiting" | "filled" | "gapped" | "stopped" | "expired"

export type OutcomeTakeStatus = "open" | "taken" | "skipped"

export type OutcomeSkipReason =
  | "chase"
  | "blackout"
  | "unstacked-slot"
  | "stop-too-tight"
  | "discretion"
  | "dead"
  | null

export interface OutcomeCard {
  schema: "grok-trading-outcome/v1"
  ticker: string
  name: string
  scanDay: string
  scan: number
  setupType: string
  grade: string
  score: number
  warnings: string[]
  lastAtScan: number
  entryPrice: number
  stopPrice: number
  limitCeiling: number
  r1: number | null
  r2: number | null
  r3: number | null
  atr14: number | null
  oneShareRisk: number | null
  stackedAtScan: boolean | null
  takeStatus: OutcomeTakeStatus
  skipReason: OutcomeSkipReason
  state: OutcomeState
  filledAt: string | null
  fillPrice: number | null
  stoppedAt: string | null
  expiredAt: string | null
  sessionsSinceScan: number
  maeR: number | null
  mfeR: number | null
  hitR1: boolean
  hitR2: boolean
  hitR3: boolean
  marks: string[]
  updatedAt: string
  ruleVersion: "outcome/v1"
}
