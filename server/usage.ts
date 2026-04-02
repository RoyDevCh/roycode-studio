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
const USAGE_PATH = path.join(DATA_DIR, 'usage.json')
const MAX_EVENTS = 4000

export type UsageSource =
  | 'cli'
  | 'task'
  | 'team'
  | 'cron'
  | 'web'
  | 'advisor'
  | 'internal'

export type UsageEvent = {
  id: string
  timestamp: string
  source: UsageSource
  providerId: string
  model: string
  workspaceRoot: string
  sessionId?: string
  taskId?: string
  success: boolean
  durationMs: number
  toolCalls: number
  inputChars: number
  outputChars: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  estimatedCostUsd?: number
  error?: string
}

type UsageStore = {
  events: UsageEvent[]
}

type UsagePricing = {
  inputUsdPer1M: number
  outputUsdPer1M: number
}

const PRICING_RULES: Array<{
  pattern: RegExp
  pricing: UsagePricing
}> = [
  {
    pattern: /gpt-5\.4|gpt-5/i,
    pricing: { inputUsdPer1M: 5, outputUsdPer1M: 15 },
  },
  {
    pattern: /gpt-4\.1|gpt-4o/i,
    pricing: { inputUsdPer1M: 5, outputUsdPer1M: 15 },
  },
  {
    pattern: /deepseek-chat/i,
    pricing: { inputUsdPer1M: 0.27, outputUsdPer1M: 1.1 },
  },
  {
    pattern: /deepseek-reasoner/i,
    pricing: { inputUsdPer1M: 0.55, outputUsdPer1M: 2.19 },
  },
]

export type UsageSummary = {
  windowDays: number
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  totalDurationMs: number
  totalToolCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalEstimatedCostUsd: number
  byProvider: Array<{ providerId: string; runs: number; estimatedCostUsd: number }>
  byModel: Array<{ model: string; runs: number; estimatedCostUsd: number }>
  bySource: Array<{ source: UsageSource; runs: number }>
  recentEvents: UsageEvent[]
}

function createStore(): UsageStore {
  return { events: [] }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(USAGE_PATH, 'utf8')
  } catch {
    await writeFile(USAGE_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<UsageStore> {
  await ensureStore()
  const raw = await readFile(USAGE_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<UsageStore>
  return {
    events: Array.isArray(parsed.events) ? parsed.events : [],
  }
}

async function writeStore(store: UsageStore): Promise<void> {
  await ensureStore()
  await writeFile(USAGE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

function estimateTokens(charCount: number): number {
  return Math.max(1, Math.ceil(charCount / 4))
}

export function estimateUsageCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = PRICING_RULES.find(rule => rule.pattern.test(model))?.pricing
  if (!pricing) {
    return undefined
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.inputUsdPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputUsdPer1M
  return inputCost + outputCost
}

export async function recordUsageEvent(input: {
  source: UsageSource
  providerId: string
  model: string
  workspaceRoot: string
  sessionId?: string
  taskId?: string
  success: boolean
  durationMs: number
  toolCalls: number
  inputChars: number
  outputChars: number
  estimatedInputTokens?: number
  estimatedOutputTokens?: number
  error?: string
}): Promise<UsageEvent> {
  const now = new Date().toISOString()
  const estimatedInputTokens = input.estimatedInputTokens ?? estimateTokens(input.inputChars)
  const estimatedOutputTokens = input.estimatedOutputTokens ?? estimateTokens(input.outputChars)
  const event: UsageEvent = {
    id: `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: now,
    source: input.source,
    providerId: input.providerId,
    model: input.model,
    workspaceRoot: input.workspaceRoot,
    sessionId: input.sessionId,
    taskId: input.taskId,
    success: input.success,
    durationMs: Math.max(0, Math.trunc(input.durationMs)),
    toolCalls: Math.max(0, Math.trunc(input.toolCalls)),
    inputChars: Math.max(0, Math.trunc(input.inputChars)),
    outputChars: Math.max(0, Math.trunc(input.outputChars)),
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd: estimateUsageCost(
      input.model,
      estimatedInputTokens,
      estimatedOutputTokens,
    ),
    error: input.error?.trim() || undefined,
  }

  const store = await readStore()
  store.events = [...store.events, event]
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
    .slice(0, MAX_EVENTS)
  await writeStore(store)
  return event
}

export async function listUsageEvents(windowDays?: number): Promise<UsageEvent[]> {
  const store = await readStore()
  const sorted = [...store.events].sort((left, right) =>
    right.timestamp.localeCompare(left.timestamp),
  )
  if (!windowDays || windowDays <= 0) {
    return sorted
  }
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000
  return sorted.filter(event => Date.parse(event.timestamp) >= cutoff)
}

function aggregateBuckets<T extends string>(
  events: UsageEvent[],
  mapKey: (event: UsageEvent) => T,
  value: (event: UsageEvent) => number = event => event.estimatedCostUsd ?? 0,
): Array<{ key: T; runs: number; total: number }> {
  const buckets = new Map<T, { runs: number; total: number }>()
  for (const event of events) {
    const key = mapKey(event)
    const current = buckets.get(key) ?? { runs: 0, total: 0 }
    current.runs += 1
    current.total += value(event)
    buckets.set(key, current)
  }
  return [...buckets.entries()]
    .map(([key, current]) => ({
      key,
      runs: current.runs,
      total: current.total,
    }))
    .sort((left, right) => right.runs - left.runs)
}

export async function summarizeUsage(windowDays = 7): Promise<UsageSummary> {
  const events = await listUsageEvents(windowDays)
  const totalEstimatedCostUsd = events.reduce(
    (sum, event) => sum + (event.estimatedCostUsd ?? 0),
    0,
  )

  return {
    windowDays,
    totalRuns: events.length,
    successfulRuns: events.filter(event => event.success).length,
    failedRuns: events.filter(event => !event.success).length,
    totalDurationMs: events.reduce((sum, event) => sum + event.durationMs, 0),
    totalToolCalls: events.reduce((sum, event) => sum + event.toolCalls, 0),
    totalInputTokens: events.reduce((sum, event) => sum + event.estimatedInputTokens, 0),
    totalOutputTokens: events.reduce((sum, event) => sum + event.estimatedOutputTokens, 0),
    totalEstimatedCostUsd,
    byProvider: aggregateBuckets(events, event => event.providerId).map(item => ({
      providerId: item.key,
      runs: item.runs,
      estimatedCostUsd: item.total,
    })),
    byModel: aggregateBuckets(events, event => event.model).map(item => ({
      model: item.key,
      runs: item.runs,
      estimatedCostUsd: item.total,
    })),
    bySource: aggregateBuckets(events, event => event.source, () => 0).map(item => ({
      source: item.key,
      runs: item.runs,
    })),
    recentEvents: events.slice(0, 10),
  }
}
