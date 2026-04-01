import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { AgentMessage, AppSettings } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const TASKS_PATH = path.join(DATA_DIR, 'tasks.json')
const TASK_LOGS_DIR = path.join(DATA_DIR, 'task-logs')
const BUILT_RUNNER = path.join(APP_ROOT, 'dist-server', 'task-runner.js')
const SOURCE_RUNNER = path.join(APP_ROOT, 'server', 'task-runner.ts')
const TSX_CLI = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export type TaskRecord = {
  id: string
  title: string
  prompt: string
  status: TaskStatus
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  workspaceRoot: string
  accessMode: AppSettings['accessMode']
  safeWriteMode: boolean
  providerId: string
  model: string
  cwd: string
  baseMessages: AgentMessage[]
  result?: string
  error?: string
  logPath: string
}

type TaskStore = {
  tasks: TaskRecord[]
}

type CreateTaskInput = {
  title?: string
  prompt: string
  workspaceRoot: string
  accessMode: AppSettings['accessMode']
  safeWriteMode: boolean
  providerId: string
  model: string
  cwd: string
  baseMessages: AgentMessage[]
}

function createStore(): TaskStore {
  return { tasks: [] }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(TASK_LOGS_DIR, { recursive: true })
  try {
    await readFile(TASKS_PATH, 'utf8')
  } catch {
    await writeFile(TASKS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<TaskStore> {
  await ensureStore()
  const raw = await readFile(TASKS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<TaskStore>
  return {
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
  }
}

async function writeStore(store: TaskStore): Promise<void> {
  await ensureStore()
  await writeFile(TASKS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function listTasks(): Promise<TaskRecord[]> {
  const store = await readStore()
  return [...store.tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  const tasks = await listTasks()
  return (
    tasks.find(task => task.id === id) ??
    tasks.find(task => task.id.startsWith(id)) ??
    null
  )
}

export async function createTask(input: CreateTaskInput): Promise<TaskRecord> {
  await ensureStore()
  const now = new Date().toISOString()
  const id = `task_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
  const logPath = path.join(TASK_LOGS_DIR, `${id}.log`)
  const record: TaskRecord = {
    id,
    title: input.title?.trim() || input.prompt.trim().slice(0, 72) || 'Background task',
    prompt: input.prompt.trim(),
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    workspaceRoot: input.workspaceRoot,
    accessMode: input.accessMode,
    safeWriteMode: input.safeWriteMode,
    providerId: input.providerId,
    model: input.model,
    cwd: input.cwd,
    baseMessages: JSON.parse(JSON.stringify(input.baseMessages)) as AgentMessage[],
    logPath,
  }

  const store = await readStore()
  store.tasks.push(record)
  await writeStore(store)
  await writeFile(logPath, `[${now}] queued ${record.title}\n`, 'utf8')
  return record
}

export async function updateTask(
  id: string,
  updater: (task: TaskRecord) => TaskRecord,
): Promise<TaskRecord> {
  const store = await readStore()
  const index = store.tasks.findIndex(task => task.id === id)
  if (index < 0) {
    throw new Error(`Task not found: ${id}`)
  }
  const next = updater(store.tasks[index] as TaskRecord)
  next.updatedAt = new Date().toISOString()
  store.tasks[index] = next
  await writeStore(store)
  return next
}

export async function appendTaskLog(taskId: string, line: string): Promise<void> {
  const task = await getTask(taskId)
  if (!task) {
    return
  }
  await appendFile(task.logPath, `${line.endsWith('\n') ? line : `${line}\n`}`, 'utf8')
}

export async function readTaskLog(taskId: string): Promise<string> {
  const task = await getTask(taskId)
  if (!task) {
    throw new Error(`Task not found: ${taskId}`)
  }
  return readFile(task.logPath, 'utf8')
}

export function launchTaskRunner(taskId: string): void {
  const args = existsSync(BUILT_RUNNER)
    ? [BUILT_RUNNER, '--id', taskId]
    : [TSX_CLI, SOURCE_RUNNER, '--id', taskId]

  const child = spawn(process.execPath, args, {
    cwd: APP_ROOT,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  })
  child.unref()
}
