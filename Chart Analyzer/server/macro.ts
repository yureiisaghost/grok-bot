import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import type { DeskMacroEvent, DeskRegime, MacroKind } from "../src/types"
import { MACRO_OVERRIDE_FILE } from "./deskPaths"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BUNDLED = path.join(__dirname, "macro-calendar.json")

export interface MacroEvent {
  date: string
  kind: MacroKind
  name: string
}

function isIsoDay(raw: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(raw)
}

function parseEvents(raw: unknown): MacroEvent[] {
  const rec = raw && typeof raw === "object" ? raw as { events?: unknown } : null
  const rows = Array.isArray(rec?.events) ? rec.events : Array.isArray(raw) ? raw : []
  const out: MacroEvent[] = []
  for (const row of rows) {
    const item = row && typeof row === "object" ? row as Record<string, unknown> : null
    const date = typeof item?.date === "string" ? item.date.slice(0, 10) : ""
    const kind = item?.kind
    const name = typeof item?.name === "string" ? item.name : String(kind ?? "")
    if (!isIsoDay(date)) continue
    if (kind !== "FOMC" && kind !== "CPI" && kind !== "NFP") continue
    out.push({ date, kind, name: name || kind })
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind))
  return out
}

export function loadMacroEvents(): MacroEvent[] {
  try {
    if (fs.existsSync(MACRO_OVERRIDE_FILE)) {
      return parseEvents(JSON.parse(fs.readFileSync(MACRO_OVERRIDE_FILE, "utf8")))
    }
  } catch {
    /* bundled file */
  }
  try {
    return parseEvents(JSON.parse(fs.readFileSync(BUNDLED, "utf8")))
  } catch {
    return []
  }
}

export function prevWeekday(iso: string): string {
  const day = new Date(`${iso}T12:00:00Z`)
  for (let i = 0; i < 7; i++) {
    day.setUTCDate(day.getUTCDate() - 1)
    const wd = day.getUTCDay()
    if (wd !== 0 && wd !== 6) return day.toISOString().slice(0, 10)
  }
  return iso
}

export function macroHit(today: string, events: MacroEvent[] = loadMacroEvents()): DeskMacroEvent | null {
  for (const event of events) {
    if (event.date === today) return { ...event, session: "event" }
    if (prevWeekday(event.date) === today) return { ...event, session: "prior" }
  }
  return null
}

export function nextMacro(today: string, events: MacroEvent[] = loadMacroEvents()): DeskMacroEvent | null {
  const hit = macroHit(today, events)
  if (hit) return hit
  return events.find((event) => event.date > today) ?? null
}

export function applyMacroBlackout(
  regime: DeskRegime,
  today: string,
  events: MacroEvent[] = loadMacroEvents(),
): DeskRegime {
  const next = nextMacro(today, events)
  const hit = macroHit(today, events)
  const stamped: DeskRegime = { ...regime, nextMacro: next, macroHit: hit }
  if (!regime.allowsNewHeat || !hit) return stamped
  const when = hit.session === "prior" ? `${hit.date} (prior session)` : hit.date
  return {
    ...stamped,
    status: "blackout",
    allowsNewHeat: false,
    reason: `Macro blackout. ${hit.kind} ${when}. No new names.`,
  }
}
