import type { Shot } from "../components/ScreenshotDrop"
import type { PlanOfAttack, ScanRow } from "../types"

const DB_NAME = "chart-analyzer"
const STORE = "session"
const KEY = "work"

export interface PersistedShot {
  id: string
  name: string
  type: string
  lastModified: number
  blob: Blob
}

export interface PersistedSession {
  rows?: ScanRow[]
  plans?: PlanOfAttack[]
  selected?: string | null
  symbols?: string[]
  keepers?: PlanOfAttack[]
  tossed?: { ticker: string; reason: string }[]
  excludedList: string[]
  index?: number
  ticker: string
  shots: PersistedShot[]
  csvNames?: string[]
  scanId?: string
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("Could not open session storage."))
  })
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as PersistedSession | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch {
    return null
  }
}

function slimPlan(plan: PlanOfAttack): PlanOfAttack {
  if (plan.grade === "Candidate" || plan.grade === "Developing") return plan
  return { ...plan, chart: [], ema20Series: [], ema50Series: [] }
}

export async function saveSession(session: PersistedSession): Promise<void> {
  const slimmed: PersistedSession = {
    ...session,
    plans: session.plans?.map(slimPlan),
    keepers: session.keepers?.map(slimPlan),
  }
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE, "readwrite").objectStore(STORE).put(slimmed, KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(KEY)
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } catch {
    // Ignore — New scan still clears in-memory state.
  }
}

export function shotToPersist(shot: Shot): PersistedShot {
  return {
    id: shot.id,
    name: shot.file.name,
    type: shot.file.type || "image/png",
    lastModified: shot.file.lastModified,
    blob: shot.file,
  }
}

export function persistToShot(row: PersistedShot): Shot {
  const file = new File([row.blob], row.name, { type: row.type, lastModified: row.lastModified })
  return { id: row.id, file, url: URL.createObjectURL(file) }
}

export function sessionHasWork(session: PersistedSession | null) {
  if (!session) return false
  return Boolean(
    session.rows?.length
    || session.plans?.length
    || session.symbols?.length
    || session.keepers?.length
    || session.tossed?.length
    || session.shots.length
    || session.csvNames?.length,
  )
}
