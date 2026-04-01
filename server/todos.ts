import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  content: string
  status: TodoStatus
  note?: string
}

type TodoStore = {
  sessions: Record<string, TodoItem[]>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const TODOS_PATH = path.join(DATA_DIR, 'todos.json')

function createStore(): TodoStore {
  return { sessions: {} }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(TODOS_PATH, 'utf8')
  } catch {
    await writeFile(TODOS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<TodoStore> {
  await ensureStore()
  const raw = await readFile(TODOS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<TodoStore>
  return {
    sessions:
      parsed.sessions && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
        ? Object.fromEntries(
            Object.entries(parsed.sessions).map(([key, value]) => [
              key,
              Array.isArray(value)
                ? value.filter(
                    (item): item is TodoItem =>
                      Boolean(
                        item &&
                          typeof item.content === 'string' &&
                          ['pending', 'in_progress', 'completed'].includes(item.status),
                      ),
                  )
                : [],
            ]),
          )
        : {},
  }
}

async function writeStore(store: TodoStore): Promise<void> {
  await ensureStore()
  await writeFile(TODOS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function normalizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim()
  if (!trimmed) {
    throw new Error('Session id is required for todo operations')
  }
  return trimmed
}

export async function readSessionTodos(sessionId: string): Promise<TodoItem[]> {
  const store = await readStore()
  return [...(store.sessions[normalizeSessionId(sessionId)] ?? [])]
}

export async function writeSessionTodos(
  sessionId: string,
  todos: TodoItem[],
): Promise<TodoItem[]> {
  const normalizedSessionId = normalizeSessionId(sessionId)
  const normalizedTodos = todos.map(todo => ({
    content: todo.content.trim(),
    status: todo.status,
    note: todo.note?.trim() || undefined,
  }))
  const store = await readStore()
  store.sessions[normalizedSessionId] = normalizedTodos
  await writeStore(store)
  return normalizedTodos
}

export async function clearSessionTodos(sessionId: string): Promise<void> {
  const store = await readStore()
  delete store.sessions[normalizeSessionId(sessionId)]
  await writeStore(store)
}
