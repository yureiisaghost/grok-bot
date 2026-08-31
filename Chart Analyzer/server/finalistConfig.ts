function envNum(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]
  const n = raw == null || raw === "" ? fallback : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function envNumOptional(name: string, min: number, max: number) {
  const raw = process.env[name]
  if (raw == null || raw === "") return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, n))
}

/** Named score buckets. Tune here, not inside detectors. */
export const SCORE_WEIGHTS = {
  pattern: 25,
  volume: 20,
  rsStage: 20,
  ma52: 15,
  rr: 10,
  distance: 10,
} as const

export function finalistConfig() {
  return {
    /** 0 = no cap. Desk ranks the full keeper universe. */
    maxNames: Math.round(envNum("FINALIST_MAX_NAMES", 0, 0, 10_000)),
    earnDays: envNum("FINALIST_EARN_DAYS", 15, 0, 90),
    minStopAtr: envNum("FINALIST_MIN_STOP_ATR", 0.25, 0.01, 2),
    maxStopAtr: envNum("FINALIST_MAX_STOP_ATR", 1.5, 0.5, 10),
    maxStopPct: envNum("FINALIST_MAX_STOP_PCT", 8, 1, 50),
    priorThrustPct: envNum("FINALIST_PRIOR_THRUST_PCT", 20, 5, 80),
    minAdvShares: envNum("FINALIST_MIN_ADV_SHARES", 200_000, 1_000, 10_000_000),
    maxNotionalAdv: envNum("FINALIST_MAX_NOTIONAL_ADV", 0.02, 0.001, 1),
    /** 0 = no per-family cap. */
    maxPerFamily: Math.round(envNum("FINALIST_MAX_PER_FAMILY", 0, 0, 10_000)),
    /** Advisory only. Unset = off. Never a hard reject. */
    maxOneShareRisk: envNumOptional("FINALIST_MAX_ONE_SHARE_RISK", 0.01, 1_000),
  }
}

export type FinalistConfig = ReturnType<typeof finalistConfig>
