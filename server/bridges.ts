import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const BRIDGES_PATH = path.join(DATA_DIR, 'bridges.json')

export type BridgeRecord = {
  id: string
  name: string
  baseUrl: string
  token?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type BridgeStore = {
  bridges: BridgeRecord[]
}

function createStore(): BridgeStore {
  return { bridges: [] }
}

function normalizeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Bridge name must contain letters or numbers')
  }
  return slug
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  const parsed = new URL(trimmed)
  return parsed.toString().replace(/\/+$/, '')
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(BRIDGES_PATH, 'utf8')
  } catch {
    await writeFile(BRIDGES_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<BridgeStore> {
  await ensureStore()
  const raw = await readFile(BRIDGES_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<BridgeStore>
  return {
    bridges: Array.isArray(parsed.bridges) ? parsed.bridges : [],
  }
}

async function writeStore(store: BridgeStore): Promise<void> {
  await ensureStore()
  await writeFile(BRIDGES_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function buildHeaders(bridge: BridgeRecord): Record<string, string> {
  const headers: Record<string, string> = {}
  if (bridge.token) {
    headers.Authorization = `Bearer ${bridge.token}`
  }
  return headers
}

export async function listBridges(): Promise<BridgeRecord[]> {
  const store = await readStore()
  return [...store.bridges].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getBridge(reference: string): Promise<BridgeRecord | null> {
  const normalized = normalizeName(reference)
  const bridges = await listBridges()
  return (
    bridges.find(bridge => bridge.name === normalized) ??
    bridges.find(bridge => bridge.name.startsWith(normalized)) ??
    bridges.find(bridge => bridge.name.includes(normalized)) ??
    null
  )
}

export async function addBridge(args: {
  name: string
  baseUrl: string
  token?: string
}): Promise<BridgeRecord> {
  const store = await readStore()
  const name = normalizeName(args.name)
  const now = new Date().toISOString()
  const next: BridgeRecord = {
    id: `bridge_${Date.now().toString(36)}`,
    name,
    baseUrl: normalizeBaseUrl(args.baseUrl),
    token: args.token?.trim() || undefined,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }

  const index = store.bridges.findIndex(bridge => bridge.name === name)
  if (index >= 0) {
    next.id = store.bridges[index]?.id ?? next.id
    next.createdAt = store.bridges[index]?.createdAt ?? now
    store.bridges[index] = next
  } else {
    store.bridges.push(next)
  }
  await writeStore(store)
  return next
}

export async function setBridgeEnabled(reference: string, enabled: boolean): Promise<BridgeRecord> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  const bridge = store.bridges.find(item => item.name === normalized)
  if (!bridge) {
    throw new Error(`Bridge not found: ${reference}`)
  }
  bridge.enabled = enabled
  bridge.updatedAt = new Date().toISOString()
  await writeStore(store)
  return bridge
}

export async function removeBridge(reference: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  store.bridges = store.bridges.filter(bridge => bridge.name !== normalized)
  await writeStore(store)
}

export async function pingBridge(reference: string): Promise<{
  bridge: BridgeRecord
  ok: boolean
  status: number
  body: string
}> {
  const bridge = await getBridge(reference)
  if (!bridge) {
    throw new Error(`Bridge not found: ${reference}`)
  }
  const response = await fetch(`${bridge.baseUrl}/api/health`, {
    headers: buildHeaders(bridge),
  })
  const body = await response.text()
  return {
    bridge,
    ok: response.ok,
    status: response.status,
    body,
  }
}

export async function fetchBridgeContext(reference: string): Promise<{
  bridge: BridgeRecord
  health: unknown
  settings: unknown
}> {
  const bridge = await getBridge(reference)
  if (!bridge) {
    throw new Error(`Bridge not found: ${reference}`)
  }

  const [healthResponse, settingsResponse] = await Promise.all([
    fetch(`${bridge.baseUrl}/api/health`, { headers: buildHeaders(bridge) }),
    fetch(`${bridge.baseUrl}/api/settings`, { headers: buildHeaders(bridge) }),
  ])

  return {
    bridge,
    health: await healthResponse.json(),
    settings: await settingsResponse.json(),
  }
}

export async function runBridgeCommand(args: {
  reference: string
  command: string
  cwd?: string
  timeoutMs?: number
}): Promise<{
  bridge: BridgeRecord
  payload: unknown
}> {
  const bridge = await getBridge(args.reference)
  if (!bridge) {
    throw new Error(`Bridge not found: ${args.reference}`)
  }

  const response = await fetch(`${bridge.baseUrl}/api/workspace/command`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...buildHeaders(bridge),
    },
    body: JSON.stringify({
      command: args.command,
      cwd: args.cwd ?? '.',
      timeoutMs: args.timeoutMs ?? 20_000,
    }),
  })

  const payload = await response.json().catch(async () => await response.text())
  if (!response.ok) {
    throw new Error(typeof payload === 'string' ? payload : JSON.stringify(payload))
  }
  return {
    bridge,
    payload,
  }
}
