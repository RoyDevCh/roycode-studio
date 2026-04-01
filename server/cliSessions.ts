import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentMessage, AppSettings, ExecutionMode } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const CLI_SESSIONS_PATH = path.join(DATA_DIR, 'cli-sessions.json')
const MAX_SESSIONS = 150

export type CliSessionRecord = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  workspaceRoot: string
  accessMode: AppSettings['accessMode']
  safeWriteMode: boolean
  providerId: string
  model: string
  cwd: string
  activeSkills?: string[]
  compactSummaries?: string[]
  executionMode?: ExecutionMode
  planFocus?: string
  worktreeBaseRoot?: string
  activeWorktreePath?: string
  messages: AgentMessage[]
}

type CliSessionStore = {
  sessions: CliSessionRecord[]
}

function createStore(): CliSessionStore {
  return { sessions: [] }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(CLI_SESSIONS_PATH, 'utf8')
  } catch {
    await writeFile(CLI_SESSIONS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<CliSessionStore> {
  await ensureStore()
  const raw = await readFile(CLI_SESSIONS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<CliSessionStore>
  return {
    sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
  }
}

async function writeStore(store: CliSessionStore): Promise<void> {
  await ensureStore()
  await writeFile(CLI_SESSIONS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function listCliSessions(): Promise<CliSessionRecord[]> {
  const store = await readStore()
  return [...store.sessions].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )
}

export async function getCliSession(id: string): Promise<CliSessionRecord | null> {
  const sessions = await listCliSessions()
  return sessions.find(session => session.id === id) ?? null
}

export async function getLatestCliSession(): Promise<CliSessionRecord | null> {
  const sessions = await listCliSessions()
  return sessions[0] ?? null
}

export async function saveCliSession(record: CliSessionRecord): Promise<void> {
  const store = await readStore()
  const existingIndex = store.sessions.findIndex(session => session.id === record.id)
  if (existingIndex >= 0) {
    store.sessions[existingIndex] = record
  } else {
    store.sessions.push(record)
  }

  store.sessions = [...store.sessions]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_SESSIONS)

  await writeStore(store)
}

export async function deleteCliSession(id: string): Promise<void> {
  const store = await readStore()
  store.sessions = store.sessions.filter(session => session.id !== id)
  await writeStore(store)
}
