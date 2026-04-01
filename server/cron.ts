import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createTask, launchTaskRunner, recordTaskRunnerPid } from './tasks.js'
import type { AccessMode } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const REGISTRY_PATH = path.join(DATA_DIR, 'cron-workspaces.json')
const LEADER_PATH = path.join(DATA_DIR, 'cron-leader.json')

const SCHEDULED_TASKS_FILE = path.join('.claude', 'scheduled_tasks.json')
const LEADER_TTL_MS = 45_000
const POLL_INTERVAL_MS = 20_000
const MAX_TASKS_PER_WORKSPACE = 50

export type CronTaskRecord = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  lastFiredAt?: number
  recurring?: boolean
  workspaceRoot: string
  accessMode: AccessMode
  safeWriteMode: boolean
  providerId: string
  model: string
  cwd: string
}

type CronTaskFile = {
  tasks: CronTaskRecord[]
}

type CronWorkspaceRegistry = {
  workspaces: string[]
}

type LeaderRecord = {
  pid: number
  heartbeatAt: number
}

export type CronTaskSummary = CronTaskRecord & {
  humanSchedule: string
  nextRunAt: string | null
}

export type CreateCronTaskInput = {
  cron: string
  prompt: string
  workspaceRoot: string
  accessMode: AccessMode
  safeWriteMode: boolean
  providerId: string
  model: string
  cwd: string
  recurring?: boolean
}

export type CronRunSummary = {
  checkedWorkspaces: number
  firedCount: number
  createdTaskIds: string[]
  errors: string[]
}

let schedulerStarted = false
let schedulerInterval: NodeJS.Timeout | null = null

type CronFields = {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
}

type FieldRange = { min: number; max: number }

const FIELD_RANGES: FieldRange[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

function createRegistry(): CronWorkspaceRegistry {
  return { workspaces: [] }
}

function createTaskFile(): CronTaskFile {
  return { tasks: [] }
}

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(REGISTRY_PATH, 'utf8')
  } catch {
    await writeFile(REGISTRY_PATH, JSON.stringify(createRegistry(), null, 2), 'utf8')
  }
}

async function ensureWorkspaceCronFile(workspaceRoot: string): Promise<string> {
  const target = path.join(workspaceRoot, SCHEDULED_TASKS_FILE)
  await mkdir(path.dirname(target), { recursive: true })
  if (!existsSync(target)) {
    await writeFile(target, JSON.stringify(createTaskFile(), null, 2), 'utf8')
  }
  return target
}

async function readRegistry(): Promise<CronWorkspaceRegistry> {
  await ensureDataDir()
  const raw = await readFile(REGISTRY_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<CronWorkspaceRegistry>
  return {
    workspaces: Array.isArray(parsed.workspaces)
      ? parsed.workspaces
          .map(item => String(item))
          .filter(Boolean)
          .map(item => path.resolve(item))
      : [],
  }
}

async function writeRegistry(store: CronWorkspaceRegistry): Promise<void> {
  await ensureDataDir()
  await writeFile(REGISTRY_PATH, JSON.stringify(store, null, 2), 'utf8')
}

async function readLeader(): Promise<LeaderRecord | null> {
  try {
    const raw = await readFile(LEADER_PATH, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<LeaderRecord>
    if (
      typeof parsed.pid !== 'number' ||
      !Number.isFinite(parsed.pid) ||
      typeof parsed.heartbeatAt !== 'number' ||
      !Number.isFinite(parsed.heartbeatAt)
    ) {
      return null
    }
    return {
      pid: parsed.pid,
      heartbeatAt: parsed.heartbeatAt,
    }
  } catch {
    return null
  }
}

async function writeLeader(record: LeaderRecord): Promise<void> {
  await ensureDataDir()
  await writeFile(LEADER_PATH, JSON.stringify(record, null, 2), 'utf8')
}

async function acquireLeadership(): Promise<boolean> {
  const now = Date.now()
  const current = await readLeader()
  if (
    !current ||
    current.pid === process.pid ||
    now - current.heartbeatAt > LEADER_TTL_MS
  ) {
    await writeLeader({
      pid: process.pid,
      heartbeatAt: now,
    })
    return true
  }
  return false
}

async function releaseLeadership(): Promise<void> {
  const current = await readLeader()
  if (current?.pid === process.pid) {
    await unlink(LEADER_PATH).catch(() => undefined)
  }
}

async function readTaskFile(workspaceRoot: string): Promise<CronTaskFile> {
  const filePath = await ensureWorkspaceCronFile(workspaceRoot)
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<CronTaskFile>
  return {
    tasks: Array.isArray(parsed.tasks)
      ? parsed.tasks
          .filter(task => Boolean(task && typeof task === 'object'))
          .map(task => {
            const record = task as Partial<CronTaskRecord>
            return {
              id: String(record.id ?? ''),
              cron: String(record.cron ?? ''),
              prompt: String(record.prompt ?? ''),
              createdAt:
                typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
                  ? record.createdAt
                  : Date.now(),
              lastFiredAt:
                typeof record.lastFiredAt === 'number' && Number.isFinite(record.lastFiredAt)
                  ? record.lastFiredAt
                  : undefined,
              recurring: Boolean(record.recurring),
              workspaceRoot: path.resolve(record.workspaceRoot || workspaceRoot),
              accessMode:
                record.accessMode === 'unrestricted' ? 'unrestricted' : 'workspace',
              safeWriteMode: Boolean(record.safeWriteMode),
              providerId: String(record.providerId ?? ''),
              model: String(record.model ?? ''),
              cwd: String(record.cwd ?? '.'),
            } satisfies CronTaskRecord
          })
          .filter(task => task.id && task.cron && task.prompt)
      : [],
  }
}

async function writeTaskFile(workspaceRoot: string, store: CronTaskFile): Promise<void> {
  const filePath = await ensureWorkspaceCronFile(workspaceRoot)
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8')
}

function expandField(field: string, range: FieldRange): number[] | null {
  const { min, max } = range
  const out = new Set<number>()

  for (const part of field.split(',')) {
    const stepMatch = part.match(/^\*(?:\/(\d+))?$/)
    if (stepMatch) {
      const step = stepMatch[1] ? Number.parseInt(stepMatch[1], 10) : 1
      if (step < 1) {
        return null
      }
      for (let value = min; value <= max; value += step) {
        out.add(value)
      }
      continue
    }

    const rangeMatch = part.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (rangeMatch) {
      const low = Number.parseInt(rangeMatch[1]!, 10)
      const high = Number.parseInt(rangeMatch[2]!, 10)
      const step = rangeMatch[3] ? Number.parseInt(rangeMatch[3], 10) : 1
      const isDow = min === 0 && max === 6
      const effectiveMax = isDow ? 7 : max
      if (low > high || step < 1 || low < min || high > effectiveMax) {
        return null
      }
      for (let value = low; value <= high; value += step) {
        out.add(isDow && value === 7 ? 0 : value)
      }
      continue
    }

    if (/^\d+$/.test(part)) {
      let value = Number.parseInt(part, 10)
      if (min === 0 && max === 6 && value === 7) {
        value = 0
      }
      if (value < min || value > max) {
        return null
      }
      out.add(value)
      continue
    }

    return null
  }

  if (!out.size) {
    return null
  }
  return [...out].sort((left, right) => left - right)
}

export function parseCronExpression(expression: string): CronFields | null {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    return null
  }

  const expanded: number[][] = []
  for (let index = 0; index < 5; index += 1) {
    const result = expandField(parts[index]!, FIELD_RANGES[index]!)
    if (!result) {
      return null
    }
    expanded.push(result)
  }

  return {
    minute: expanded[0]!,
    hour: expanded[1]!,
    dayOfMonth: expanded[2]!,
    month: expanded[3]!,
    dayOfWeek: expanded[4]!,
  }
}

export function computeNextCronRun(fields: CronFields, from: Date): Date | null {
  const minuteSet = new Set(fields.minute)
  const hourSet = new Set(fields.hour)
  const domSet = new Set(fields.dayOfMonth)
  const monthSet = new Set(fields.month)
  const dowSet = new Set(fields.dayOfWeek)

  const domWild = fields.dayOfMonth.length === 31
  const dowWild = fields.dayOfWeek.length === 7

  const pointer = new Date(from.getTime())
  pointer.setSeconds(0, 0)
  pointer.setMinutes(pointer.getMinutes() + 1)

  const maxIterations = 366 * 24 * 60
  for (let index = 0; index < maxIterations; index += 1) {
    const month = pointer.getMonth() + 1
    if (!monthSet.has(month)) {
      pointer.setMonth(pointer.getMonth() + 1, 1)
      pointer.setHours(0, 0, 0, 0)
      continue
    }

    const dayOfMonth = pointer.getDate()
    const dayOfWeek = pointer.getDay()
    const dayMatches =
      domWild && dowWild
        ? true
        : domWild
          ? dowSet.has(dayOfWeek)
          : dowWild
            ? domSet.has(dayOfMonth)
            : domSet.has(dayOfMonth) || dowSet.has(dayOfWeek)

    if (!dayMatches) {
      pointer.setDate(pointer.getDate() + 1)
      pointer.setHours(0, 0, 0, 0)
      continue
    }

    if (!hourSet.has(pointer.getHours())) {
      pointer.setHours(pointer.getHours() + 1, 0, 0, 0)
      continue
    }

    if (!minuteSet.has(pointer.getMinutes())) {
      pointer.setMinutes(pointer.getMinutes() + 1)
      continue
    }

    return pointer
  }

  return null
}

function formatLocalTime(minute: number, hour: number): string {
  const date = new Date(2000, 0, 1, hour, minute)
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    return cron
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]

  const everyMinuteMatch = minute.match(/^\*\/(\d+)$/)
  if (
    everyMinuteMatch &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const interval = Number.parseInt(everyMinuteMatch[1]!, 10)
    return interval === 1 ? 'Every minute' : `Every ${interval} minutes`
  }

  if (
    /^\d+$/.test(minute) &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const parsedMinute = Number.parseInt(minute, 10)
    return parsedMinute === 0
      ? 'Every hour'
      : `Every hour at :${String(parsedMinute).padStart(2, '0')}`
  }

  const everyHourMatch = hour.match(/^\*\/(\d+)$/)
  if (
    /^\d+$/.test(minute) &&
    everyHourMatch &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const parsedMinute = Number.parseInt(minute, 10)
    const interval = Number.parseInt(everyHourMatch[1]!, 10)
    const suffix = parsedMinute === 0 ? '' : ` at :${String(parsedMinute).padStart(2, '0')}`
    return interval === 1 ? `Every hour${suffix}` : `Every ${interval} hours${suffix}`
  }

  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) {
    return cron
  }

  const parsedMinute = Number.parseInt(minute, 10)
  const parsedHour = Number.parseInt(hour, 10)
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `Every day at ${formatLocalTime(parsedMinute, parsedHour)}`
  }
  if (dayOfMonth === '*' && month === '*' && /^\d$/.test(dayOfWeek)) {
    const dayIndex = Number.parseInt(dayOfWeek, 10) % 7
    return `Every ${DAY_NAMES[dayIndex]!} at ${formatLocalTime(parsedMinute, parsedHour)}`
  }
  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '1-5') {
    return `Weekdays at ${formatLocalTime(parsedMinute, parsedHour)}`
  }
  return cron
}

export function nextCronRunMs(cron: string, fromMs: number): number | null {
  const fields = parseCronExpression(cron)
  if (!fields) {
    return null
  }
  const next = computeNextCronRun(fields, new Date(fromMs))
  return next ? next.getTime() : null
}

export async function registerCronWorkspace(workspaceRoot: string): Promise<void> {
  const resolved = path.resolve(workspaceRoot)
  const registry = await readRegistry()
  if (!registry.workspaces.includes(resolved)) {
    registry.workspaces.push(resolved)
    registry.workspaces.sort((left, right) => left.localeCompare(right))
    await writeRegistry(registry)
  }
  await ensureWorkspaceCronFile(resolved)
}

export async function listRegisteredCronWorkspaces(): Promise<string[]> {
  const registry = await readRegistry()
  return registry.workspaces
}

export async function listCronTasks(workspaceRoot: string): Promise<CronTaskSummary[]> {
  const resolved = path.resolve(workspaceRoot)
  await registerCronWorkspace(resolved)
  const store = await readTaskFile(resolved)
  const now = Date.now()
  return store.tasks.map(task => ({
    ...task,
    humanSchedule: cronToHuman(task.cron),
    nextRunAt: (() => {
      const next = nextCronRunMs(task.cron, task.lastFiredAt ?? task.createdAt ?? now)
      return next ? new Date(next).toISOString() : null
    })(),
  }))
}

export async function createCronTask(input: CreateCronTaskInput): Promise<CronTaskRecord> {
  const resolvedWorkspace = path.resolve(input.workspaceRoot)
  const parsed = parseCronExpression(input.cron)
  if (!parsed) {
    throw new Error(`Invalid cron expression: ${input.cron}`)
  }
  if (nextCronRunMs(input.cron, Date.now()) === null) {
    throw new Error('Cron expression does not match any future time in the next year')
  }

  await registerCronWorkspace(resolvedWorkspace)
  const store = await readTaskFile(resolvedWorkspace)
  if (store.tasks.length >= MAX_TASKS_PER_WORKSPACE) {
    throw new Error(`Too many scheduled tasks in this workspace (max ${MAX_TASKS_PER_WORKSPACE})`)
  }

  const task: CronTaskRecord = {
    id: `cron_${randomUUID().slice(0, 8)}`,
    cron: input.cron.trim(),
    prompt: input.prompt.trim(),
    createdAt: Date.now(),
    recurring: input.recurring !== false,
    workspaceRoot: resolvedWorkspace,
    accessMode: input.accessMode,
    safeWriteMode: input.safeWriteMode,
    providerId: input.providerId,
    model: input.model,
    cwd: input.cwd || '.',
  }
  store.tasks.push(task)
  await writeTaskFile(resolvedWorkspace, store)
  return task
}

export async function deleteCronTask(
  workspaceRoot: string,
  reference: string,
): Promise<CronTaskRecord | null> {
  const resolvedWorkspace = path.resolve(workspaceRoot)
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    throw new Error('Cron task id is required')
  }
  const store = await readTaskFile(resolvedWorkspace)
  const task =
    store.tasks.find(item => item.id.toLowerCase() === normalized) ??
    store.tasks.find(item => item.id.toLowerCase().startsWith(normalized)) ??
    store.tasks.find(item => item.prompt.toLowerCase().includes(normalized)) ??
    null
  if (!task) {
    return null
  }
  store.tasks = store.tasks.filter(item => item.id !== task.id)
  await writeTaskFile(resolvedWorkspace, store)
  return task
}

async function fireCronTask(task: CronTaskRecord): Promise<string> {
  const created = await createTask({
    title: `Scheduled: ${task.prompt.slice(0, 56) || cronToHuman(task.cron)}`,
    prompt: task.prompt,
    workspaceRoot: task.workspaceRoot,
    accessMode: task.accessMode,
    safeWriteMode: task.safeWriteMode,
    providerId: task.providerId,
    model: task.model,
    cwd: task.cwd || '.',
    baseMessages: [],
  })
  await recordTaskRunnerPid(created.id, launchTaskRunner(created.id))
  return created.id
}

export async function runDueCronTasks(
  workspaceRoots?: string[],
): Promise<CronRunSummary> {
  const roots = workspaceRoots?.length ? workspaceRoots : await listRegisteredCronWorkspaces()
  const summary: CronRunSummary = {
    checkedWorkspaces: 0,
    firedCount: 0,
    createdTaskIds: [],
    errors: [],
  }
  const now = Date.now()

  for (const workspaceRoot of roots) {
    summary.checkedWorkspaces += 1
    try {
      const resolvedWorkspace = path.resolve(workspaceRoot)
      const store = await readTaskFile(resolvedWorkspace)
      let changed = false
      const remaining: CronTaskRecord[] = []

      for (const task of store.tasks) {
        const nextRunAt = nextCronRunMs(task.cron, task.lastFiredAt ?? task.createdAt)
        if (nextRunAt !== null && nextRunAt <= now) {
          const createdTaskId = await fireCronTask(task)
          summary.firedCount += 1
          summary.createdTaskIds.push(createdTaskId)
          changed = true
          if (task.recurring) {
            remaining.push({
              ...task,
              lastFiredAt: now,
            })
          }
        } else {
          remaining.push(task)
        }
      }

      if (changed) {
        await writeTaskFile(resolvedWorkspace, { tasks: remaining })
      }
    } catch (error) {
      summary.errors.push(
        `${workspaceRoot}: ${error instanceof Error ? error.message : 'Unknown cron error'}`,
      )
    }
  }

  return summary
}

async function pollCronScheduler(): Promise<void> {
  const leader = await acquireLeadership()
  if (!leader) {
    return
  }
  await runDueCronTasks()
}

export async function startCronScheduler(initialWorkspaces: string[] = []): Promise<void> {
  for (const workspaceRoot of initialWorkspaces) {
    await registerCronWorkspace(workspaceRoot)
  }

  if (schedulerStarted) {
    return
  }
  schedulerStarted = true
  await pollCronScheduler().catch(() => undefined)
  schedulerInterval = setInterval(() => {
    void pollCronScheduler().catch(() => undefined)
  }, POLL_INTERVAL_MS)
}

export async function stopCronScheduler(): Promise<void> {
  schedulerStarted = false
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
  await releaseLeadership()
}
