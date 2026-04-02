import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type DiagnosticEventKind = 'slash-command' | 'prompt' | 'system'
export type DiagnosticStatus = 'success' | 'error' | 'blocked'

export type DiagnosticEvent = {
  id: string
  timestamp: string
  kind: DiagnosticEventKind
  name: string
  status: DiagnosticStatus
  durationMs: number
  workspaceRoot: string
  sessionId?: string
  metadata?: Record<string, unknown>
}

type DiagnosticStore = {
  events: DiagnosticEvent[]
}

export type DiagnosticSummary = {
  totalEvents: number
  windowDays: number
  byKind: Array<{ kind: DiagnosticEventKind; count: number }>
  byStatus: Array<{ status: DiagnosticStatus; count: number }>
  byName: Array<{ name: string; count: number }>
  recentEvents: DiagnosticEvent[]
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const DIAGNOSTICS_PATH = path.join(DATA_DIR, 'diagnostics.json')
const MAX_EVENTS = 5000

function createStore(): DiagnosticStore {
  return { events: [] }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(DIAGNOSTICS_PATH, 'utf8')
  } catch {
    await writeFile(DIAGNOSTICS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<DiagnosticStore> {
  await ensureStore()
  const raw = await readFile(DIAGNOSTICS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<DiagnosticStore>
  return {
    events: Array.isArray(parsed.events) ? parsed.events : [],
  }
}

async function writeStore(store: DiagnosticStore): Promise<void> {
  await ensureStore()
  await writeFile(DIAGNOSTICS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function recordDiagnosticEvent(input: {
  kind: DiagnosticEventKind
  name: string
  status: DiagnosticStatus
  durationMs: number
  workspaceRoot: string
  sessionId?: string
  metadata?: Record<string, unknown>
}): Promise<DiagnosticEvent> {
  const event: DiagnosticEvent = {
    id: `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    kind: input.kind,
    name: input.name,
    status: input.status,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    workspaceRoot: input.workspaceRoot,
    sessionId: input.sessionId,
    metadata: input.metadata,
  }

  const store = await readStore()
  store.events = [event, ...store.events]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, MAX_EVENTS)
  await writeStore(store)
  return event
}

export async function listDiagnosticEvents(options?: {
  kind?: DiagnosticEventKind
  limit?: number
  windowDays?: number
}): Promise<DiagnosticEvent[]> {
  const store = await readStore()
  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 200)
  const cutoff =
    options?.windowDays && options.windowDays > 0
      ? Date.now() - options.windowDays * 24 * 60 * 60 * 1000
      : 0
  return store.events
    .filter(event => (options?.kind ? event.kind === options.kind : true))
    .filter(event => (cutoff ? Date.parse(event.timestamp) >= cutoff : true))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, limit)
}

function aggregate<T extends string>(
  values: T[],
): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || String(left.key).localeCompare(String(right.key)))
}

export async function summarizeDiagnostics(windowDays = 7): Promise<DiagnosticSummary> {
  const events = await listDiagnosticEvents({ limit: MAX_EVENTS, windowDays })
  return {
    totalEvents: events.length,
    windowDays,
    byKind: aggregate(events.map(event => event.kind)).map(item => ({
      kind: item.key,
      count: item.count,
    })),
    byStatus: aggregate(events.map(event => event.status)).map(item => ({
      status: item.key,
      count: item.count,
    })),
    byName: aggregate(events.map(event => event.name)).slice(0, 20).map(item => ({
      name: item.key,
      count: item.count,
    })),
    recentEvents: events.slice(0, 15),
  }
}

export async function exportDiagnostics(
  targetPath: string,
  windowDays?: number,
): Promise<{ path: string; count: number }> {
  const events = await listDiagnosticEvents({ limit: MAX_EVENTS, windowDays })
  const resolved = path.resolve(targetPath)
  await mkdir(path.dirname(resolved), { recursive: true })
  await writeFile(resolved, JSON.stringify({ events }, null, 2), 'utf8')
  return { path: resolved, count: events.length }
}

export async function clearDiagnostics(): Promise<void> {
  await rm(DIAGNOSTICS_PATH, { force: true })
}
