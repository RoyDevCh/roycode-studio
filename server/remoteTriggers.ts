import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const TRIGGERS_PATH = path.join(DATA_DIR, 'remote-triggers.json')

export type RemoteTriggerRecord = {
  id: string
  name: string
  url: string
  method: 'POST' | 'PUT'
  token?: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

type TriggerStore = {
  triggers: RemoteTriggerRecord[]
}

function createStore(): TriggerStore {
  return { triggers: [] }
}

function normalizeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Trigger name must contain letters or numbers')
  }
  return slug
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(TRIGGERS_PATH, 'utf8')
  } catch {
    await writeFile(TRIGGERS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<TriggerStore> {
  await ensureStore()
  const raw = await readFile(TRIGGERS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<TriggerStore>
  return {
    triggers: Array.isArray(parsed.triggers) ? parsed.triggers : [],
  }
}

async function writeStore(store: TriggerStore): Promise<void> {
  await ensureStore()
  await writeFile(TRIGGERS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function listRemoteTriggers(): Promise<RemoteTriggerRecord[]> {
  const store = await readStore()
  return [...store.triggers].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getRemoteTrigger(reference: string): Promise<RemoteTriggerRecord | null> {
  const normalized = normalizeName(reference)
  const triggers = await listRemoteTriggers()
  return (
    triggers.find(trigger => trigger.name === normalized) ??
    triggers.find(trigger => trigger.name.startsWith(normalized)) ??
    triggers.find(trigger => trigger.name.includes(normalized)) ??
    null
  )
}

export async function addRemoteTrigger(args: {
  name: string
  url: string
  method?: 'POST' | 'PUT'
  token?: string
}): Promise<RemoteTriggerRecord> {
  const store = await readStore()
  const name = normalizeName(args.name)
  const now = new Date().toISOString()
  const next: RemoteTriggerRecord = {
    id: `trigger_${Date.now().toString(36)}`,
    name,
    url: new URL(args.url.trim()).toString(),
    method: args.method ?? 'POST',
    token: args.token?.trim() || undefined,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }

  const index = store.triggers.findIndex(trigger => trigger.name === name)
  if (index >= 0) {
    next.id = store.triggers[index]?.id ?? next.id
    next.createdAt = store.triggers[index]?.createdAt ?? now
    store.triggers[index] = next
  } else {
    store.triggers.push(next)
  }
  await writeStore(store)
  return next
}

export async function setRemoteTriggerEnabled(
  reference: string,
  enabled: boolean,
): Promise<RemoteTriggerRecord> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  const trigger = store.triggers.find(item => item.name === normalized)
  if (!trigger) {
    throw new Error(`Remote trigger not found: ${reference}`)
  }
  trigger.enabled = enabled
  trigger.updatedAt = new Date().toISOString()
  await writeStore(store)
  return trigger
}

export async function removeRemoteTrigger(reference: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  store.triggers = store.triggers.filter(trigger => trigger.name !== normalized)
  await writeStore(store)
}

export async function fireRemoteTrigger(args: {
  reference: string
  payload?: Record<string, unknown>
}): Promise<{
  trigger: RemoteTriggerRecord
  status: number
  ok: boolean
  body: string
}> {
  const trigger = await getRemoteTrigger(args.reference)
  if (!trigger) {
    throw new Error(`Remote trigger not found: ${args.reference}`)
  }
  if (!trigger.enabled) {
    throw new Error(`Remote trigger is disabled: ${trigger.name}`)
  }

  const response = await fetch(trigger.url, {
    method: trigger.method,
    headers: {
      'content-type': 'application/json',
      ...(trigger.token ? { authorization: `Bearer ${trigger.token}` } : {}),
    },
    body: JSON.stringify(
      args.payload ?? {
        source: 'roycode',
        triggeredAt: new Date().toISOString(),
      },
    ),
  })

  return {
    trigger,
    status: response.status,
    ok: response.ok,
    body: await response.text(),
  }
}
