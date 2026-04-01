import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AccessMode } from './types.js'
import { runWorkspaceCommand } from './filesystem.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const HOOKS_PATH = path.join(DATA_DIR, 'hooks.json')

export const HOOK_EVENTS = [
  'session-start',
  'instructions-loaded',
  'before-prompt',
  'user-prompt-submit',
  'after-prompt',
  'before-tool',
  'after-tool',
  'slash-command',
  'subagent-start',
  'subagent-stop',
  'task-created',
  'task-completed',
  'config-changed',
  'pre-compact',
  'post-compact',
  'stop',
] as const

export type HookEventName = (typeof HOOK_EVENTS)[number]

export type HookDefinition = {
  id: string
  event: HookEventName
  command: string
  enabled: boolean
  updatedAt: string
  matcher?: string
}

type HookStore = {
  hooks: HookDefinition[]
}

export type HookRuntimeContext = {
  workspaceRoot: string
  cwd: string
  accessMode: AccessMode
  timeoutMs: number
  sessionId?: string
  sessionTitle?: string
  prompt?: string
  assistant?: string
  toolName?: string
  toolInput?: string
  toolOutput?: string
  commandName?: string
  commandArgs?: string
  taskId?: string
  taskTitle?: string
  taskStatus?: string
  agentName?: string
  configKey?: string
  configValue?: string
}

export type HookExecutionResult = {
  rawOutput: string | null
  displayOutput: string | null
  continue: boolean
  stopReason?: string
  systemMessage?: string
  additionalContext?: string
  updatedInput?: string
  suppressOutput: boolean
}

function createStore(): HookStore {
  return { hooks: [] }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(HOOKS_PATH, 'utf8')
  } catch {
    await writeFile(HOOKS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<HookStore> {
  await ensureStore()
  const raw = await readFile(HOOKS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<HookStore>
  const hooks = Array.isArray(parsed.hooks) ? parsed.hooks : []
  return {
    hooks: hooks
      .filter(hook =>
        Boolean(
          hook &&
            typeof hook === 'object' &&
            typeof hook.event === 'string' &&
            typeof hook.command === 'string' &&
            typeof hook.enabled === 'boolean',
        ),
      )
      .map(hook => ({
        id:
          typeof hook.id === 'string' && hook.id.trim()
            ? hook.id
            : `hook_${randomUUID().slice(0, 8)}`,
        event: hook.event as HookEventName,
        command: hook.command as string,
        enabled: hook.enabled as boolean,
        updatedAt:
          typeof hook.updatedAt === 'string' && hook.updatedAt
            ? hook.updatedAt
            : new Date().toISOString(),
        matcher:
          typeof hook.matcher === 'string' && hook.matcher.trim()
            ? hook.matcher.trim()
            : undefined,
      })),
  }
}

async function writeStore(store: HookStore): Promise<void> {
  await ensureStore()
  await writeFile(HOOKS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

export async function listHooks(): Promise<HookDefinition[]> {
  const store = await readStore()
  return [...store.hooks].sort((left, right) =>
    left.event === right.event
      ? left.updatedAt.localeCompare(right.updatedAt)
      : left.event.localeCompare(right.event),
  )
}

export async function getHook(event: HookEventName): Promise<HookDefinition | null> {
  const hooks = await listHooks()
  return hooks.find(hook => hook.event === event) ?? null
}

export async function addHook(
  event: HookEventName,
  command: string,
  matcher?: string,
): Promise<HookDefinition> {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('Hook command cannot be empty')
  }

  const store = await readStore()
  const nextHook: HookDefinition = {
    id: `hook_${randomUUID().slice(0, 8)}`,
    event,
    command: trimmed,
    enabled: true,
    updatedAt: new Date().toISOString(),
    matcher: matcher?.trim() || undefined,
  }
  store.hooks.push(nextHook)
  await writeStore(store)
  return nextHook
}

export async function setHook(
  event: HookEventName,
  command: string,
  matcher?: string,
): Promise<HookDefinition> {
  const store = await readStore()
  store.hooks = store.hooks.filter(hook => hook.event !== event)
  await writeStore(store)
  return addHook(event, command, matcher)
}

export async function clearHook(event: HookEventName): Promise<void> {
  const store = await readStore()
  store.hooks = store.hooks.filter(hook => hook.event !== event)
  await writeStore(store)
}

export async function removeHook(reference: string): Promise<void> {
  const trimmed = reference.trim()
  if (!trimmed) {
    throw new Error('Hook id is required')
  }
  const store = await readStore()
  store.hooks = store.hooks.filter(hook => hook.id !== trimmed)
  await writeStore(store)
}

export async function setHookEnabled(reference: string, enabled: boolean): Promise<void> {
  const trimmed = reference.trim()
  if (!trimmed) {
    throw new Error('Hook id is required')
  }
  const store = await readStore()
  const hook = store.hooks.find(item => item.id === trimmed)
  if (!hook) {
    throw new Error(`Hook not found: ${trimmed}`)
  }
  hook.enabled = enabled
  hook.updatedAt = new Date().toISOString()
  await writeStore(store)
}

function applyTemplate(command: string, context: HookRuntimeContext, event: HookEventName): string {
  const replacements: Record<string, string> = {
    '{{event}}': event,
    '{{workspaceRoot}}': context.workspaceRoot,
    '{{cwd}}': context.cwd,
    '{{sessionId}}': context.sessionId || '',
    '{{sessionTitle}}': context.sessionTitle || '',
    '{{prompt}}': context.prompt || '',
    '{{assistant}}': context.assistant || '',
    '{{toolName}}': context.toolName || '',
    '{{toolInput}}': context.toolInput || '',
    '{{toolOutput}}': context.toolOutput || '',
    '{{commandName}}': context.commandName || '',
    '{{commandArgs}}': context.commandArgs || '',
    '{{taskId}}': context.taskId || '',
    '{{taskTitle}}': context.taskTitle || '',
    '{{taskStatus}}': context.taskStatus || '',
    '{{agentName}}': context.agentName || '',
    '{{configKey}}': context.configKey || '',
    '{{configValue}}': context.configValue || '',
  }

  let output = command
  for (const [token, value] of Object.entries(replacements)) {
    output = output.split(token).join(value)
  }
  return output
}

function toHookEnv(event: HookEventName, context: HookRuntimeContext): Record<string, string> {
  return {
    ROYCODE_HOOK_EVENT: event,
    ROYCODE_WORKSPACE_ROOT: context.workspaceRoot,
    ROYCODE_CWD: context.cwd,
    ROYCODE_SESSION_ID: context.sessionId || '',
    ROYCODE_SESSION_TITLE: context.sessionTitle || '',
    ROYCODE_PROMPT: context.prompt || '',
    ROYCODE_ASSISTANT: context.assistant || '',
    ROYCODE_TOOL_NAME: context.toolName || '',
    ROYCODE_TOOL_INPUT: context.toolInput || '',
    ROYCODE_TOOL_OUTPUT: context.toolOutput || '',
    ROYCODE_COMMAND_NAME: context.commandName || '',
    ROYCODE_COMMAND_ARGS: context.commandArgs || '',
    ROYCODE_TASK_ID: context.taskId || '',
    ROYCODE_TASK_TITLE: context.taskTitle || '',
    ROYCODE_TASK_STATUS: context.taskStatus || '',
    ROYCODE_AGENT_NAME: context.agentName || '',
    ROYCODE_CONFIG_KEY: context.configKey || '',
    ROYCODE_CONFIG_VALUE: context.configValue || '',
  }
}

function tryParseJsonValue(value: string | undefined): unknown {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return trimmed
  }
}

function buildHookInputPayload(
  event: HookEventName,
  context: HookRuntimeContext,
): string {
  const payload = {
    hook_event: event,
    session_id: context.sessionId ?? '',
    session_title: context.sessionTitle ?? '',
    workspace_root: context.workspaceRoot,
    cwd: context.cwd,
    prompt: context.prompt,
    assistant: context.assistant,
    tool_name: context.toolName,
    tool_input: tryParseJsonValue(context.toolInput),
    tool_response: tryParseJsonValue(context.toolOutput),
    command_name: context.commandName,
    command_args: context.commandArgs,
    task_id: context.taskId,
    task_title: context.taskTitle,
    task_status: context.taskStatus,
    agent_name: context.agentName,
    config_key: context.configKey,
    config_value: context.configValue,
  }
  return JSON.stringify(payload, null, 2)
}

function parseHookExecutionResult(output: string | null): HookExecutionResult {
  const trimmed = output?.trim() || ''
  if (!trimmed) {
    return {
      rawOutput: null,
      displayOutput: null,
      continue: true,
      suppressOutput: false,
    }
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const continueValue =
      typeof parsed.continue === 'boolean' ? parsed.continue : parsed.decision !== 'block'
    const hookSpecificOutput =
      parsed.hookSpecificOutput &&
      typeof parsed.hookSpecificOutput === 'object' &&
      !Array.isArray(parsed.hookSpecificOutput)
        ? (parsed.hookSpecificOutput as Record<string, unknown>)
        : null

    const additionalContext =
      typeof hookSpecificOutput?.additionalContext === 'string'
        ? hookSpecificOutput.additionalContext.trim() || undefined
        : undefined
    const updatedInput =
      typeof hookSpecificOutput?.updatedInput === 'string'
        ? hookSpecificOutput.updatedInput
        : undefined

    return {
      rawOutput: trimmed,
      displayOutput:
        typeof parsed.suppressOutput === 'boolean' && parsed.suppressOutput
          ? null
          : trimmed,
      continue: continueValue,
      stopReason:
        typeof parsed.stopReason === 'string'
          ? parsed.stopReason
          : typeof parsed.reason === 'string'
            ? parsed.reason
            : undefined,
      systemMessage:
        typeof parsed.systemMessage === 'string' ? parsed.systemMessage : undefined,
      additionalContext,
      updatedInput,
      suppressOutput: Boolean(parsed.suppressOutput),
    }
  } catch {
    return {
      rawOutput: trimmed,
      displayOutput: trimmed,
      continue: true,
      suppressOutput: false,
    }
  }
}

function matchesHook(hook: HookDefinition, context: HookRuntimeContext): boolean {
  const matcher = hook.matcher?.trim()
  if (!matcher) {
    return true
  }

  const haystack = [
    hook.event,
    context.workspaceRoot,
    context.cwd,
    context.sessionId,
    context.sessionTitle,
    context.prompt,
    context.assistant,
    context.toolName,
    context.toolInput,
    context.toolOutput,
    context.commandName,
    context.commandArgs,
    context.taskId,
    context.taskTitle,
    context.taskStatus,
    context.agentName,
    context.configKey,
    context.configValue,
  ]
    .filter(Boolean)
    .join('\n')

  if (matcher.startsWith('/') && matcher.endsWith('/') && matcher.length > 2) {
    try {
      return new RegExp(matcher.slice(1, -1), 'i').test(haystack)
    } catch {
      return haystack.toLowerCase().includes(matcher.toLowerCase())
    }
  }

  return haystack.toLowerCase().includes(matcher.toLowerCase())
}

export async function runHook(
  event: HookEventName,
  context: HookRuntimeContext,
): Promise<HookExecutionResult> {
  const hooks = (await listHooks()).filter(
    hook => hook.event === event && hook.enabled && matchesHook(hook, context),
  )
  if (!hooks.length) {
    return {
      rawOutput: null,
      displayOutput: null,
      continue: true,
      suppressOutput: false,
    }
  }

  let currentContext: HookRuntimeContext = { ...context }
  const rawOutputs: string[] = []
  const displayOutputs: string[] = []
  const systemMessages: string[] = []
  const additionalContexts: string[] = []
  let updatedInput: string | undefined

  for (const hook of hooks) {
    const command = applyTemplate(hook.command, currentContext, event)
    const output = await runWorkspaceCommand(
      currentContext.workspaceRoot,
      command,
      currentContext.cwd,
      Math.min(currentContext.timeoutMs, 30_000),
      currentContext.accessMode,
      toHookEnv(event, currentContext),
      undefined,
      buildHookInputPayload(event, currentContext),
    )
    const result = parseHookExecutionResult(output)

    if (result.rawOutput) {
      rawOutputs.push(result.rawOutput)
    }
    if (result.displayOutput) {
      displayOutputs.push(result.displayOutput)
    }
    if (result.systemMessage) {
      systemMessages.push(result.systemMessage)
    }
    if (result.additionalContext) {
      additionalContexts.push(result.additionalContext)
    }
    if (result.updatedInput) {
      updatedInput = result.updatedInput
      currentContext = {
        ...currentContext,
        prompt: result.updatedInput,
      }
    }
    if (!result.continue) {
      return {
        rawOutput: rawOutputs.length ? rawOutputs.join('\n\n') : null,
        displayOutput: displayOutputs.length ? displayOutputs.join('\n\n') : null,
        continue: false,
        stopReason: result.stopReason,
        systemMessage: systemMessages.join(' | ') || undefined,
        additionalContext: additionalContexts.join('\n\n') || undefined,
        updatedInput,
        suppressOutput: result.suppressOutput,
      }
    }
  }

  return {
    rawOutput: rawOutputs.length ? rawOutputs.join('\n\n') : null,
    displayOutput: displayOutputs.length ? displayOutputs.join('\n\n') : null,
    continue: true,
    systemMessage: systemMessages.join(' | ') || undefined,
    additionalContext: additionalContexts.join('\n\n') || undefined,
    updatedInput,
    suppressOutput: false,
  }
}
