import path from 'node:path'
import process from 'node:process'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import {
  buildFileTree,
  readWorkspaceFile,
  runWorkspaceCommand,
  searchWorkspace,
} from './filesystem.js'
import {
  addHook,
  clearHook,
  HOOK_EVENTS,
  listHooks,
  removeHook,
  runHook,
  setHook,
  setHookEnabled,
  type HookEventName,
} from './hooks.js'
import {
  buildActiveSkillSystemMessage,
  buildLocalSkillPrompt,
  getLocalSkill,
  importLocalSkill,
  listLocalSkills,
} from './skills.js'
import {
  buildPluginCommandPrompt,
  getPluginCommand,
  importLocalPlugin,
  listInstalledPlugins,
  listPluginCommands,
  listPluginOutputStyles,
  removePlugin,
  setPluginEnabled,
} from './pluginRuntime.js'
import {
  addBridge,
  fetchBridgeContext,
  listBridges,
  pingBridge,
  removeBridge,
  runBridgeCommand,
  setBridgeEnabled,
} from './bridges.js'
import {
  buildLocalCompatCommandPrompt,
  getLocalCompatCommand,
  listLocalCompatCommands,
} from './localCommands.js'
import {
  getLocalAgent,
  listLocalAgents,
  type LocalAgentDefinition,
} from './localAgents.js'
import {
  buildLspRenameEditPlan,
  getLspDefinitions,
  getLspDiagnostics,
  getLspDocumentSymbols,
  getLspHover,
  getLspImplementations,
  getLspRenamePreview,
  getLspReferences,
  getLspWorkspaceSymbols,
} from './lsp.js'
import {
  addMarketplaceItem,
  installMarketplaceItem,
  listMarketplaceItems,
  removeMarketplaceItem,
} from './marketplace.js'
import {
  addNotebookCell,
  deleteNotebookCell,
  listNotebookCells,
  readNotebookCell,
  setNotebookCellSource,
} from './notebooks.js'
import {
  addTeamMember,
  appendTeamMemory,
  clearTeamMessages,
  createTeam,
  getTeam,
  getTeamMemory,
  listTeams,
  listTeamMessages,
  removeTeam,
  removeTeamMember,
  scanTeamMemory,
  sendTeamMessage,
  setTeamMemory,
  syncTeamMemoryFromMessages,
} from './teams.js'
import { buildBrowserSearchUrl, openUrlInBrowser } from './chrome.js'
import { describeVoiceSupport, listenForSpeech, speakText } from './voice.js'
import { describeNotifierSupport, sendLocalNotification } from './notifier.js'
import {
  disableSleepGuard,
  enableSleepGuard,
  getSleepGuardStatus,
} from './sleepGuard.js'
import {
  describeSettingsSync,
  exportSettingsBundle,
  importSettingsBundle,
} from './settingsSync.js'
import {
  addRemoteTrigger,
  fireRemoteTrigger,
  listRemoteTriggers,
  removeRemoteTrigger,
  setRemoteTriggerEnabled,
} from './remoteTriggers.js'
import { webFetch, webSearch } from './web.js'
import {
  applyWorkspaceBatchChanges,
  applyAllPendingChanges,
  applyPendingChange,
  discardPendingChange,
  listPendingChanges,
} from './pendingChanges.js'
import { streamAgentChat } from './agent.js'
import {
  commitGitChanges,
  getGitDiff,
  getGitStatus,
  stageGitFile,
  unstageGitFile,
} from './git.js'
import {
  deleteCliSession,
  getLatestCliSession,
  listCliSessions,
  saveCliSession,
  type CliSessionRecord,
} from './cliSessions.js'
import { readSettings, writeSettings } from './store.js'
import {
  appendTaskLog,
  createTask,
  getTask,
  launchTaskRunner,
  listTasks,
  readTaskLog,
  recordTaskRunnerPid,
  restartTask,
  stopTask,
  updateTaskMetadata,
} from './tasks.js'
import {
  appendWorkspaceMemory,
  listWorkspaceInstructionFiles,
  readWorkspaceMemory,
  writeWorkspaceMemory,
} from './workspaceContext.js'
import {
  appendAgentMemory,
  getApplicableRules,
  listLocalOutputStyles,
  listLocalRules,
  readAgentMemory,
  writeAgentMemory,
  type AgentMemoryScope,
  type LocalRuleDocument,
  type LocalOutputStyleDocument,
} from './claudeCompat.js'
import {
  getCompatConfigValue,
  listSupportedConfigEntries,
  setCompatConfigValue,
} from './configCompat.js'
import { inspectProjectMcpJson,
  addHttpMcpServer,
  addStdioMcpServer,
  callMcpTool,
  getMcpPrompt,
  inspectMcpServer,
  listMcpPrompts,
  listMcpResources,
  listMcpServers,
  listMcpTools,
  readMcpResource,
  removeMcpServer,
  setMcpServerBearerToken,
  setMcpServerEnabled,
  setMcpServerEnv,
  setMcpServerHeader,
  unsetMcpServerEnv,
  unsetMcpServerHeader,
  type LocalMcpServerConfig,
} from './mcp.js'
import {
  DEFAULT_OUTPUT_STYLE_NAME,
  getOutputStyleConfig,
  listAvailableOutputStyles,
} from './outputStyles.js'
import { clearSessionTodos, readSessionTodos, writeSessionTodos } from './todos.js'
import {
  addGitWorktree,
  findGitWorktree,
  inspectGitWorktree,
  listGitWorktrees,
  pruneGitWorktrees,
  removeGitWorktree,
} from './worktrees.js'
import {
  cronToHuman,
  createCronTask,
  deleteCronTask,
  listCronTasks,
  registerCronWorkspace,
  runDueCronTasks,
  startCronScheduler,
  stopCronScheduler,
} from './cron.js'
import {
  recordUsageEvent,
  summarizeUsage,
  type UsageSource,
} from './usage.js'
import { buildPromptSuggestions } from './suggestions.js'
import type {
  AccessMode,
  AgentMessage,
  AppSettings,
  EffortLevel,
  ExecutionMode,
  FileNode,
  PendingChange,
  ProviderConfig,
  StructuredQuestionPrompt,
  StructuredQuestionRequest,
  StructuredQuestionResponse,
  TodoItem,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const PACKAGE_JSON_PATH = path.join(APP_ROOT, 'package.json')

type CliAttachment = {
  path: string
  content: string
  truncated: boolean
}

type CliOptions = {
  help: boolean
  prompt?: string
  printMode: boolean
  webSearchQuery?: string
  webFetchUrl?: string
  workspace?: string
  provider?: string
  model?: string
  access?: AccessMode
  dangerouslySkipPermissions: boolean
  safeWriteMode?: boolean
  cwd?: string
  attachments: string[]
  resume?: string
  listSessions: boolean
  title?: string
  newSession: boolean
  skills: string[]
  appendSystemPrompts: string[]
  allowedTools?: string
  outputFormat?: string
}

type CliState = {
  settings: AppSettings
  cwd: string
  messages: AgentMessage[]
  pendingAttachments: CliAttachment[]
  activeSkills: string[]
  compactSummaries: string[]
  lastSuggestions: string[]
  sessionId: string
  sessionTitle: string
  sessionCreatedAt: string
  explicitTitle: boolean
  sessionTouched: boolean
  executionMode: ExecutionMode
  planFocus?: string
  worktreeBaseRoot?: string
  activeWorktreePath?: string
}

type ThinkbackSummary = {
  totalSessions: number
  activeSessionsLast30Days: number
  totalMessages: number
  totalCompactions: number
  topWorkspaces: Array<{ workspaceRoot: string; count: number }>
  topModels: Array<{ model: string; count: number }>
  topProviders: Array<{ providerId: string; count: number }>
  topModes: Array<{ mode: string; count: number }>
  recentTitles: string[]
}

const MAX_ATTACHMENT_CHARS = 12_000
const MAX_FILE_PREVIEW_LINES = 220
const MAX_FILE_PREVIEW_CHARS = 18_000
const MAX_MESSAGE_TITLE_LENGTH = 72
const MAX_RELEASE_NOTES = 10

const EFFORT_DESCRIPTIONS: Record<EffortLevel, string> = {
  auto: 'Use the default balance for the selected model and workflow.',
  low: 'Prefer quick, direct answers and the smallest safe change.',
  medium: 'Balance speed, code quality, and verification depth.',
  high: 'Spend more effort on exploration, risk analysis, and validation.',
  max: 'Use the deepest local reasoning style available in RoyCode.',
}

const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const CYAN = '\x1b[36m'

let activeReadline: ReturnType<typeof createInterface> | null = null
let colorModeOverride: 'auto' | 'on' | 'off' = 'auto'

function supportsColor(): boolean {
  if (colorModeOverride === 'on') {
    return true
  }
  if (colorModeOverride === 'off') {
    return false
  }
  return process.stdout.isTTY === true
}

function colorize(value: string, color: string): string {
  return supportsColor() ? `${color}${value}${RESET}` : value
}

function info(text: string): void {
  process.stdout.write(`${colorize('i', BLUE)} ${text}\n`)
}

function ok(text: string): void {
  process.stdout.write(`${colorize('+', GREEN)} ${text}\n`)
}

function warn(text: string): void {
  process.stdout.write(`${colorize('!', YELLOW)} ${text}\n`)
}

function fail(text: string): void {
  process.stdout.write(`${colorize('x', RED)} ${text}\n`)
}

function label(text: string): string {
  return colorize(text, BOLD)
}

function dim(text: string): string {
  return colorize(text, DIM)
}

function cyan(text: string): string {
  return colorize(text, CYAN)
}

function green(text: string): string {
  return colorize(text, GREEN)
}

function red(text: string): string {
  return colorize(text, RED)
}

function yellow(text: string): string {
  return colorize(text, YELLOW)
}

function blue(text: string): string {
  return colorize(text, BLUE)
}

function magenta(text: string): string {
  return colorize(text, MAGENTA)
}

function printDivider(): void {
  process.stdout.write(`${dim('-'.repeat(88))}\n`)
}

async function execProcessCapture(
  command: string,
  args: string[],
  options: {
    cwd?: string
    timeoutMs?: number
    env?: NodeJS.ProcessEnv
  } = {},
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`${command} timed out after ${options.timeoutMs ?? 20_000}ms`))
    }, options.timeoutMs ?? 20_000)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
      }
    })
  })
}

function truncate(value: string, max = 140): string {
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function createSessionId(): string {
  return `s_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`
}

function cloneMessages(messages: AgentMessage[]): AgentMessage[] {
  return JSON.parse(JSON.stringify(messages)) as AgentMessage[]
}

function extractMessageText(message: AgentMessage): string {
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

function measureMessageChars(messages: AgentMessage[]): number {
  return messages.reduce((sum, message) => sum + extractMessageText(message).length, 0)
}

function getEffortEnvOverride(): EffortLevel | undefined {
  const raw =
    process.env.ROYCODE_EFFORT_LEVEL?.trim().toLowerCase() ||
    process.env.CLAUDE_CODE_EFFORT_LEVEL?.trim().toLowerCase() ||
    ''
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'max' || raw === 'auto') {
    return raw
  }
  return undefined
}

function resolveEffortLevel(settings: AppSettings): EffortLevel {
  return getEffortEnvOverride() ?? settings.effortLevel ?? 'auto'
}

function describeEffortLevel(level: EffortLevel): string {
  return EFFORT_DESCRIPTIONS[level]
}

function resolveMaxAgentSteps(
  settings: AppSettings,
  override?: number,
): number | undefined {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return override
  }

  const base = settings.maxAgentSteps
  switch (resolveEffortLevel(settings)) {
    case 'low':
      return Math.max(2, Math.min(base, 5))
    case 'medium':
    case 'auto':
      return base
    case 'high':
      return Math.max(base, 12)
    case 'max':
      return Math.max(base, 18)
  }
}

function buildEffortSystemAddenda(settings: AppSettings): string[] {
  const level = resolveEffortLevel(settings)
  if (level === 'auto') {
    return []
  }
  return [
    `RoyCode effort level is ${level}. ${describeEffortLevel(level)}`,
    level === 'low'
      ? 'Bias toward straightforward answers, fast iteration, and minimal tool use.'
      : level === 'medium'
        ? 'Balance exploration and delivery; verify key claims but do not over-invest.'
        : level === 'high'
          ? 'Invest more in reading, risk analysis, and validation before concluding.'
          : 'Use the deepest available reasoning style in this local runtime, with explicit tradeoffs and thorough verification.',
  ]
}

function deriveTitleFromPrompt(rawInput: string): string {
  const normalized = rawInput.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'New session'
  }
  return truncate(normalized, MAX_MESSAGE_TITLE_LENGTH)
}

function createFreshState(settings: AppSettings): CliState {
  return {
    settings,
    cwd: '.',
    messages: [],
    pendingAttachments: [],
    activeSkills: [],
    compactSummaries: [],
    lastSuggestions: [],
    sessionId: createSessionId(),
    sessionTitle: 'New session',
    sessionCreatedAt: new Date().toISOString(),
    explicitTitle: false,
    sessionTouched: false,
    executionMode: 'default',
  }
}

function makeUniqueSessionTitle(
  desiredTitle: string,
  existingTitles: Set<string>,
): string {
  const baseTitle = truncate(desiredTitle.trim() || 'New session', MAX_MESSAGE_TITLE_LENGTH)
  let candidate = baseTitle
  let counter = 2
  while (existingTitles.has(candidate.toLowerCase())) {
    const suffix = ` (${counter})`
    candidate = truncate(
      baseTitle.slice(0, Math.max(1, MAX_MESSAGE_TITLE_LENGTH - suffix.length)) + suffix,
      MAX_MESSAGE_TITLE_LENGTH,
    )
    counter += 1
  }
  return candidate
}

function buildBranchTitleBase(currentTitle: string, requestedTitle: string): string {
  const trimmedRequested = requestedTitle.trim()
  if (trimmedRequested) {
    return trimmedRequested
  }

  const normalizedCurrent = currentTitle.trim() || 'New session'
  if (/branch/i.test(normalizedCurrent)) {
    return normalizedCurrent
  }
  return `${normalizedCurrent} (Branch)`
}

function shouldPersistSession(state: CliState): boolean {
  return (
    state.sessionTouched ||
    state.messages.length > 0 ||
    state.compactSummaries.length > 0 ||
    state.explicitTitle ||
    state.sessionTitle !== 'New session' ||
    state.executionMode !== 'default'
  )
}

function getSelectedProvider(settings: AppSettings): ProviderConfig {
  const provider =
    settings.providers.find(item => item.id === settings.selectedProviderId) ??
    settings.providers[0]

  if (!provider) {
    throw new Error('No providers are configured. Add a provider in settings.json first.')
  }

  return provider
}

function resolveModel(settings: AppSettings, provider: ProviderConfig): string {
  if (settings.selectedModel && provider.models.includes(settings.selectedModel)) {
    return settings.selectedModel
  }
  return settings.selectedModel || provider.defaultModel || provider.models[0] || ''
}

function findProvider(settings: AppSettings, token: string): ProviderConfig | null {
  const normalized = token.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  return (
    settings.providers.find(provider => provider.id.toLowerCase() === normalized) ??
    settings.providers.find(provider => provider.name.toLowerCase() === normalized) ??
    settings.providers.find(provider => provider.preset.toLowerCase() === normalized) ??
    settings.providers.find(provider => provider.name.toLowerCase().includes(normalized)) ??
    null
  )
}

function buildPromptLabel(state: CliState): string {
  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const shortModel = model.length > 24 ? `${model.slice(0, 24)}...` : model
  const modeSuffix =
    state.executionMode === 'default' ? '' : ` ${yellow(`[${describeExecutionMode(state)}]`)}`
  const briefSuffix = state.settings.briefMode ? ` ${dim('[brief]')}` : ''
  const voiceSuffix = state.settings.voiceMode ? ` ${dim('[voice]')}` : ''
  const effortSuffix =
    resolveEffortLevel(state.settings) !== 'auto'
      ? ` ${dim(`[effort:${resolveEffortLevel(state.settings)}]`)}`
      : ''
  const suggestSuffix =
    state.settings.promptSuggestionEnabled !== false ? ` ${dim('[suggest]')}` : ''
  const advisorSuffix = state.settings.advisorModel
    ? ` ${dim(`[advisor:${state.settings.advisorModel}]`)}`
    : ''
  return `${cyan('roycode')} ${dim(`[${provider.name}:${shortModel}]`)}${briefSuffix}${voiceSuffix}${effortSuffix}${suggestSuffix}${advisorSuffix}${modeSuffix} ${cyan('> ')}`
}

function normalizeCommand(input: string): {
  name: string
  rawArgs: string
} {
  const withoutSlash = input.trim().slice(1).trim()
  const firstSpace = withoutSlash.indexOf(' ')
  if (firstSpace === -1) {
    return {
      name: withoutSlash.toLowerCase(),
      rawArgs: '',
    }
  }

  return {
    name: withoutSlash.slice(0, firstSpace).toLowerCase(),
    rawArgs: withoutSlash.slice(firstSpace + 1).trim(),
  }
}

function formatAttachmentContext(attachments: CliAttachment[]): string {
  if (!attachments.length) {
    return ''
  }

  return attachments
    .map(attachment =>
      [
        `[Attached file: path=${attachment.path}${attachment.truncated ? ', truncated=true' : ''}]`,
        attachment.content,
      ].join('\n'),
    )
    .join('\n\n')
}

function formatMessageCount(messages: AgentMessage[]): string {
  const userTurns = messages.filter(message => message.role === 'user').length
  const assistantTurns = messages.filter(message => message.role === 'assistant').length
  return `${userTurns} user / ${assistantTurns} assistant`
}

function countUserTurns(messages: AgentMessage[]): number {
  return messages.filter(message => message.role === 'user').length
}

function buildCompactSystemMessage(state: CliState): string | null {
  if (!state.compactSummaries.length) {
    return null
  }

  return [
    'Conversation summary from earlier compacted turns. Treat this as durable session context.',
    ...state.compactSummaries.map((summary, index) => `## Compact Summary ${index + 1}\n${summary}`),
  ].join('\n\n')
}

function sanitizeFileSlug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'session'
}

function formatAgentMessageContent(content: AgentMessage['content']): string {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map(part => {
      if (part.type === 'text') {
        return part.text
      }
      return `[image: ${part.imageUrl}]`
    })
    .join('\n')
}

function renderSessionMarkdown(state: CliState): string {
  const lines: string[] = [
    `# ${state.sessionTitle}`,
    '',
    `- Session ID: ${state.sessionId}`,
    `- Created: ${state.sessionCreatedAt}`,
    `- Workspace: ${state.settings.workspaceRoot}`,
    `- Access Mode: ${state.settings.accessMode}`,
    `- CWD: ${state.cwd}`,
    `- Active Skills: ${state.activeSkills.length ? state.activeSkills.join(', ') : 'none'}`,
    '',
  ]

  if (state.compactSummaries.length) {
    lines.push('## Compact Summaries', '')
    state.compactSummaries.forEach((summary, index) => {
      lines.push(`### Summary ${index + 1}`, '', summary, '')
    })
  }

  lines.push('## Transcript', '')
  for (const message of state.messages) {
    const role = message.role.charAt(0).toUpperCase() + message.role.slice(1)
    lines.push(`### ${role}`, '', formatAgentMessageContent(message.content), '')
  }

  return lines.join('\n').trimEnd() + '\n'
}

async function copyTextToClipboard(text: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('clip.exe', [], {
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `clip.exe exited with code ${code}`))
      }
    })
    child.stdin.write(text)
    child.stdin.end()
  })
}

function describeExecutionMode(state: CliState): string {
  if (state.executionMode === 'plan') {
    return state.planFocus?.trim()
      ? `plan (${state.planFocus.trim()})`
      : 'plan'
  }
  if (state.executionMode === 'worktree') {
    return state.activeWorktreePath
      ? `worktree (${state.activeWorktreePath})`
      : 'worktree'
  }
  return 'default'
}

function buildModeSystemAddenda(state: CliState): {
  extraSystemAddenda: string[]
  disallowedTools: string[]
} {
  if (state.executionMode === 'plan') {
    return {
      extraSystemAddenda: [
        'You are in RoyCode plan mode.',
        'Treat this as a read-only planning pass: inspect, analyze, and propose work, but do not make changes.',
        'Do not write files, edit notebooks, change config, create worktrees, schedule tasks, or run shell commands that mutate the environment.',
        ...(state.planFocus?.trim()
          ? [`Current plan-mode focus: ${state.planFocus.trim()}`]
          : []),
      ],
      disallowedTools: [
        'write_file',
        'replace_in_file',
        'run_command',
        'set_config',
        'todo_write',
        'create_task',
        'create_cron_task',
        'delete_cron_task',
        'create_worktree',
        'remove_worktree',
        'edit_notebook_cell',
        'add_notebook_cell',
        'delete_notebook_cell',
        'create_team',
        'create_team_tasks',
        'run_subagent',
      ],
    }
  }

  if (state.executionMode === 'worktree') {
    return {
      extraSystemAddenda: [
        'You are currently operating inside RoyCode worktree mode.',
        ...(state.activeWorktreePath
          ? [`Active isolated worktree: ${state.activeWorktreePath}`]
          : []),
        ...(state.worktreeBaseRoot
          ? [`Base repository root: ${state.worktreeBaseRoot}`]
          : []),
      ],
      disallowedTools: [],
    }
  }

  return {
    extraSystemAddenda: [],
    disallowedTools: [],
  }
}

function normalizeToolList(value?: string[] | string): string[] | undefined {
  if (!value) {
    return undefined
  }

  const rawItems = Array.isArray(value) ? value : value.split(',')
  const items = rawItems
    .map(item => item.trim())
    .filter(Boolean)

  return items.length ? [...new Set(items)] : undefined
}

function isPlanModeWriteCommand(commandName: string, rawArgs: string): boolean {
  const argTokens = rawArgs.trim().split(/\s+/).filter(Boolean)
  const firstArg = argTokens[0]?.toLowerCase() ?? ''
  const secondArg = argTokens[1]?.toLowerCase() ?? ''

  switch (commandName) {
    case 'branch':
    case 'rename':
    case 'title':
    case 'new':
    case 'delete-session':
    case 'compact':
    case 'rewind':
    case 'theme':
    case 'effort':
    case 'vim':
    case 'brief':
    case 'voice':
    case 'workspace':
    case 'access':
    case 'permissions':
    case 'safe-write':
    case 'safewrite':
    case 'cwd':
    case 'run':
    case 'teleport':
    case 'apply':
    case 'reject':
      return true
    case 'cron':
      return ['add', 'remove', 'run-due'].includes(firstArg)
    case 'plan-mode':
    case 'planmode':
      return firstArg === 'enter'
    case 'worktree-mode':
    case 'worktreemode':
      return firstArg === 'enter'
    case 'hook':
      return ['add', 'set', 'clear', 'remove', 'enable', 'disable'].includes(firstArg)
    case 'skill':
      return ['use', 'drop', 'import'].includes(firstArg)
    case 'plugin':
      return ['import', 'enable', 'disable', 'remove'].includes(firstArg)
    case 'memory':
      return ['set', 'append', 'clear', 'extract'].includes(firstArg)
    case 'session':
      return ['branch', 'export', 'resume', 'title', 'rename', 'delete'].includes(firstArg)
    case 'agent-memory':
    case 'agentmemory':
      return ['set', 'append'].includes(firstArg)
    case 'config':
      return firstArg === 'set'
    case 'output-style':
    case 'outputstyle':
      return Boolean(firstArg)
    case 'todos':
    case 'todo':
      return ['add', 'doing', 'done', 'remove', 'clear'].includes(firstArg)
    case 'mcp':
      return [
        'add-stdio',
        'add-http',
        'enable',
        'disable',
        'remove',
        'set-header',
        'unset-header',
        'set-env',
        'unset-env',
        'bearer',
        'set-bearer',
        'call',
      ].includes(firstArg)
    case 'worktree':
    case 'worktrees':
      return ['add', 'remove', 'prune', 'switch'].includes(firstArg)
    case 'notebook':
      return ['set', 'add', 'delete'].includes(firstArg)
    case 'team':
      if (['create', 'task', 'message', 'clear-inbox', 'delete', 'remove'].includes(firstArg)) {
        return true
      }
      if (firstArg === 'memory') {
        return ['set', 'append', 'sync'].includes(secondArg || 'show')
      }
      return false
    case 'settings-sync':
    case 'settingssync':
      return ['import'].includes(firstArg)
    case 'advisor':
      return !['', 'status', 'review', 'ask', 'run'].includes(firstArg)
    case 'suggest':
      return ['on', 'off', 'toggle'].includes(firstArg)
    case 'notifications':
      return ['on', 'off', 'toggle'].includes(firstArg)
    case 'notify':
      return true
    case 'upgrade':
      return firstArg === 'run'
    case 'sleep-guard':
    case 'sleepguard':
      return ['on', 'off', 'toggle'].includes(firstArg)
    case 'remote-trigger':
    case 'remotetrigger':
      return ['add', 'enable', 'disable', 'remove', 'delete'].includes(firstArg)
    case 'bridge':
      return ['add', 'remove', 'enable', 'disable', 'run'].includes(firstArg)
    case 'marketplace':
      return ['add', 'remove', 'install'].includes(firstArg)
    case 'lsp':
      return firstArg === 'rename-apply'
    case 'task':
      return ['start', 'stop', 'retry', 'update'].includes(firstArg)
    case 'git':
      return ['stage', 'unstage', 'commit'].includes(firstArg)
    case 'color':
      return ['on', 'off', 'auto'].includes(firstArg)
    default:
      return false
  }
}

function resolveStructuredQuestionAnswer(
  rawAnswer: string,
  question: StructuredQuestionPrompt,
): string | null {
  const trimmed = rawAnswer.trim()
  if (!trimmed) {
    return null
  }

  const tokens = question.multiSelect
    ? trimmed
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    : [trimmed]

  const selectedLabels: string[] = []

  for (const token of tokens) {
    const numericIndex = Number.parseInt(token, 10)
    if (
      Number.isFinite(numericIndex) &&
      String(numericIndex) === token &&
      numericIndex >= 1 &&
      numericIndex <= question.options.length
    ) {
      selectedLabels.push(question.options[numericIndex - 1]!.label)
      continue
    }

    const normalized = token.toLowerCase()
    const matchedOption =
      question.options.find(option => option.label.toLowerCase() === normalized) ??
      question.options.find(option => option.label.toLowerCase().startsWith(normalized)) ??
      question.options.find(option => option.label.toLowerCase().includes(normalized))

    if (matchedOption) {
      selectedLabels.push(matchedOption.label)
      continue
    }

    if (!question.multiSelect) {
      return trimmed
    }

    return null
  }

  const uniqueLabels = [...new Set(selectedLabels)]
  if (!uniqueLabels.length) {
    return null
  }
  return question.multiSelect ? uniqueLabels.join(', ') : uniqueLabels[0]!
}

async function askStructuredQuestions(
  request: StructuredQuestionRequest,
): Promise<StructuredQuestionResponse> {
  if (!activeReadline || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Structured questions require an interactive RoyCode terminal session')
  }

  printDivider()
  info(
    `Agent needs ${request.questions.length} clarification ${request.questions.length === 1 ? 'question' : 'questions'}`,
  )

  const answers: Record<string, string> = {}
  for (const question of request.questions) {
    process.stdout.write(`\n${label(question.header)} ${question.question}\n`)
    question.options.forEach((option, index) => {
      process.stdout.write(
        `  ${dim(`${index + 1}.`)} ${option.label}${option.description ? dim(` - ${option.description}`) : ''}\n`,
      )
    })
    process.stdout.write(
      `${dim(
        question.multiSelect
          ? 'Enter one or more option numbers/labels separated by commas.'
          : 'Enter an option number, label, or your own short answer.',
      )}\n`,
    )

    while (true) {
      const rawAnswer = await activeReadline.question(`${dim('answer')} `)
      const resolved = resolveStructuredQuestionAnswer(rawAnswer, question)
      if (!resolved) {
        warn('Please choose a valid option or provide a short answer.')
        continue
      }
      answers[question.question] = resolved
      break
    }
  }

  printDivider()
  return { answers }
}

function printStatus(state: CliState): void {
  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  process.stdout.write(
    [
      `${label('session')} ${state.sessionTitle} (${dim(state.sessionId)})`,
      `${label('messages')} ${formatMessageCount(state.messages)}`,
      `${label('attachments')} ${state.pendingAttachments.length}`,
      `${label('workspace')} ${state.settings.workspaceRoot}`,
      `${label('access')} ${state.settings.accessMode}`,
      `${label('theme')} ${state.settings.theme || 'dark'}`,
      `${label('vim')} ${(state.settings.vimMode ?? false) ? green('on') : red('off')}`,
      `${label('brief')} ${(state.settings.briefMode ?? false) ? green('on') : red('off')}`,
      `${label('voice')} ${(state.settings.voiceMode ?? false) ? green('on') : red('off')}`,
      `${label('effort')} ${resolveEffortLevel(state.settings)}`,
      `${label('suggest')} ${state.settings.promptSuggestionEnabled !== false ? green('on') : red('off')}`,
      `${label('notify')} ${(state.settings.notificationsEnabled ?? false) ? green('on') : red('off')}`,
      `${label('sleep-guard')} ${(state.settings.sleepGuardMode ?? false) ? green('on') : red('off')}`,
      `${label('safe-write')} ${state.settings.safeWriteMode ? green('on') : red('off')}`,
      `${label('style')} ${state.settings.outputStyle || DEFAULT_OUTPUT_STYLE_NAME}`,
      `${label('provider')} ${provider.name}`,
      `${label('model')} ${model || 'none'}`,
      `${label('advisor')} ${state.settings.advisorModel || 'off'}`,
      `${label('cwd')} ${state.cwd}`,
      `${label('mode')} ${describeExecutionMode(state)}`,
      `${label('skills')} ${state.activeSkills.length ? state.activeSkills.join(', ') : 'none'}`,
      `${label('summaries')} ${state.compactSummaries.length}`,
      `${label('suggestions')} ${state.lastSuggestions.length}`,
    ].join(` ${dim('|')} `) + '\n',
  )
}

function printBanner(state: CliState): void {
  printDivider()
  process.stdout.write(`${label('RoyCode CLI')}\n`)
  process.stdout.write(
    `${dim('Claude Code style terminal workflow built on the local RoyCode agent core.')}\n`,
  )
  process.stdout.write(
    `${dim('Type /help for commands. Type /multiline for pasted blocks. Normal input sends a prompt. Hooks, skills, and tasks are available.')}\n`,
  )
  printDivider()
  printStatus(state)
}

async function saveCurrentSession(state: CliState): Promise<void> {
  if (!shouldPersistSession(state)) {
    return
  }

  const provider = getSelectedProvider(state.settings)
  const record: CliSessionRecord = {
    id: state.sessionId,
    title: state.sessionTitle,
    createdAt: state.sessionCreatedAt,
    updatedAt: new Date().toISOString(),
    workspaceRoot: state.settings.workspaceRoot,
    accessMode: state.settings.accessMode,
    safeWriteMode: state.settings.safeWriteMode,
    providerId: provider.id,
    model: resolveModel(state.settings, provider),
    cwd: state.cwd,
    activeSkills: [...state.activeSkills],
    compactSummaries: [...state.compactSummaries],
    executionMode: state.executionMode,
    planFocus: state.planFocus,
    worktreeBaseRoot: state.worktreeBaseRoot,
    activeWorktreePath: state.activeWorktreePath,
    messages: cloneMessages(state.messages),
  }

  await saveCliSession(record)
}

function printCliUsage(): void {
  process.stdout.write(
    [
      'Usage:',
      '  npm run cli -- [options]',
      '',
      'Options:',
      '  --help                 Show CLI help',
      '  --prompt <text>        Run one prompt and exit',
      '  -p, --print <text>     Claude-style print mode (plain final answer)',
      '  --plain                Force the direct line-based CLI instead of the TUI launcher',
      '  --web-search <query>   Run one web search and exit',
      '  --web-fetch <url>      Fetch one public URL and exit',
      '  --workspace <path>     Set workspace root',
      '  --skill <name>         Activate a local skill for this session (repeatable)',
      '  --provider <id|name>   Select provider',
      '  --model <name>         Select model',
      '  --access <mode>        workspace or unrestricted',
      '  --dangerously-skip-permissions',
      '                         Enable unrestricted filesystem access and disable safe-write prompts',
      '  --full-access          Alias for --dangerously-skip-permissions',
      '  --safe-write           Enable approval mode',
      '  --unsafe-write         Disable approval mode',
      '  --cwd <path>           Set default tool cwd',
      '  --attach <path>        Attach a file to the next prompt (repeatable)',
      '  --allowedTools <list>  Claude compatibility flag (currently advisory only)',
      '  --append-system-prompt <text>',
      '                         Append one extra system prompt section (repeatable)',
      '  --output-format <fmt>  Claude compatibility flag (text/json), text supported',
      '  --resume [id|latest]   Resume a saved CLI session',
      '  --list-sessions        List saved sessions',
      '  --title <text>         Set the current session title',
      '  --new                  Force a fresh session',
      '',
      'Notes:',
      '  - The "roycode" launcher now opens an Ink-style TUI by default in interactive terminals.',
      '  - Use --plain if you want the direct line-based CLI instead of the TUI wrapper.',
      '  - Paths with spaces are supported. If your shell needs it, wrap them in quotes.',
      '  - In piped mode, each incoming line is processed as a prompt or slash command.',
      '',
    ].join('\n'),
  )
}

function printHelp(): void {
  printDivider()
  process.stdout.write(`${label('Local commands')}\n`)
  process.stdout.write(
    [
      '/help - show help',
      '/status - show current session status',
      '/providers - list configured providers',
      '/provider <id|name> - switch provider',
      '/models - list models for the current provider',
      '/model <name> - switch model under the current provider',
      '/theme <dark|light|auto> - switch the preferred RoyCode theme',
      '/color [on|off|auto|test] - control or preview ANSI color output',
      '/vim <on|off|toggle> - toggle vim-style input mode preference',
      '/brief <on|off|toggle> - toggle concise brief-mode replies',
      '/voice <on|off|toggle|say> - toggle or use local voice output',
      '/effort [auto|low|medium|high|max] - set reasoning depth for future turns',
      '/statusline - print the compact RoyCode status line',
      '/keybindings - print the main TUI keybindings',
      '/version - print RoyCode build and runtime version details',
      '/release-notes [count] - show recent RoyCode commits from this local checkout',
      '/upgrade [status|run] - inspect or self-update this RoyCode checkout',
      '/workspace <path> - change workspace root',
      '/access <workspace|unrestricted> - change filesystem mode',
      '/permissions <full|safe|workspace> - switch permission preset',
      '/safe-write <on|off> - toggle approval mode',
      '/cwd <path> - change default cwd for tool calls',
      '/attach <path> - attach a file to the next prompt',
      '/attachments - list queued attachments',
      '/files [path] [depth] - list workspace files',
      '/read <path> - read a file with line numbers',
      '/search <query> - search text in workspace files',
      '/web-search <query> - search the public web for current information',
      '/web-fetch <url> - fetch readable text from a public URL',
      '/run <command> - run a shell command in the current cwd',
      '/hooks - list configured event hooks',
      '/hook add <event> <command> [--match <text>] - add a hook',
      '/hook set <event> <command> [--match <text>] - replace hooks for one event',
      '/hook clear <event> - remove hooks for one event',
      '/hook remove <id> - remove one hook by id',
      '/skills - list local skills',
      '/commands - list auto-loaded Claude-style slash commands and plugin commands',
      '/commands show <name> - preview one local Claude-style command',
      '/agents - list auto-loaded Claude-style subagents',
      '/agent show <name> - inspect one local subagent definition',
      '/agent run <name> <prompt> - run one local subagent in isolation',
      '/skill use <name> - activate a skill for this session',
      '/skill drop <name|all> - deactivate one or all active skills',
      '/skill show <name> - preview a local skill',
      '/skill import <path> [name] - import a markdown file, skill dir, .skill, or .zip as a local skill',
      '/plugins - list installed local plugins',
      '/plugin import <path> [name] - import a local plugin directory',
      '/plugin enable <name> - enable a local plugin',
      '/plugin disable <name> - disable a local plugin',
      '/plugin remove <name> - remove a local plugin',
      '/plugin commands [plugin] - list plugin commands',
      '/plugin show <name> - preview one plugin command',
      '/instructions - show auto-loaded workspace instruction files',
      '/context - inspect the currently loaded Claude-style context layers',
      '/doctor - run local health checks for workspace, output styles, providers, and MCP',
      '/rules - list applicable Claude-style rule documents',
      '/rules all - list every discovered Claude-style rule document',
      '/rules show <name> - preview one rule document',
      '/memory - show workspace memory',
      '/memory set <text> - replace workspace memory',
      '/memory append <text> - append to workspace memory',
      '/memory extract [instructions] - extract durable memory from this session',
      '/memory clear - reset workspace memory',
      '/agent-memory show <agent> [scope] - inspect subagent memory',
      '/agent-memory set <agent> <scope> <text> - replace agent memory',
      '/agent-memory append <agent> <scope> <text> - append to agent memory',
      '/config - list supported RoyCode config settings',
      '/config get <key> - read one config setting',
      '/config set <key> <value> - update one config setting',
      '/output-style - list available output styles',
      '/output-style <name> - select one output style',
      '/todos - show the current session todo list',
      '/todos add <text> - append one pending todo',
      '/todos doing <index> - mark one todo as in progress',
      '/todos done <index> - mark one todo as completed',
      '/todos remove <index> - remove one todo',
      '/todos clear - clear all session todos',
      '/mcp - list configured MCP servers',
      '/mcp add-stdio <name> <command> [args...] - register one stdio MCP server',
      '/mcp add-http <name> <url> - register one Streamable HTTP MCP server',
      '/mcp enable <name> - enable a configured MCP server',
      '/mcp disable <name> - disable a configured MCP server',
      '/mcp remove <name> - remove a configured MCP server',
      '/mcp inspect <server> - inspect one MCP server config',
      '/mcp set-header <server> <key> <value> - persist one HTTP header for a saved MCP server',
      '/mcp unset-header <server> <key> - remove one persisted HTTP header',
      '/mcp set-env <server> <key> <value> - persist one stdio env var for a saved MCP server',
      '/mcp unset-env <server> <key> - remove one persisted stdio env var',
      '/mcp bearer <server> <token> - set Authorization: Bearer ... for one HTTP MCP server',
      '/mcp tools <server> - list tools exposed by one MCP server',
      '/mcp prompts <server> - list prompts exposed by one MCP server',
      '/mcp resources <server> - list resources exposed by one MCP server',
      '/mcp call <server> <tool> [json] - call one MCP tool',
      '/mcp prompt <server> <prompt> [json] - resolve one MCP prompt',
      '/mcp resource <server> <uri> - read one MCP resource',
      '/cron - list scheduled local prompts for this workspace',
      '/cron add "<cron>" "<prompt>" [--once] - schedule a local prompt',
      '/cron remove <id> - remove a scheduled prompt',
      '/cron run-due - manually trigger due scheduled prompts now',
      '/worktree - list git worktrees',
      '/worktree show <ref> - inspect one git worktree',
      '/worktree switch <ref> - switch the session workspace to a git worktree',
      '/worktree add <path> [branch] [base] - create a git worktree',
      '/worktree remove <path> [--force] - remove a git worktree',
      '/plan-mode [enter|exit|status] - toggle read-only planning mode',
      '/worktree-mode [enter|exit|status] - bind this session to an isolated worktree and restore later',
      '/teleport worktree <name|path> - switch the session workspace to a git worktree',
      '/notebook cells <path> - list notebook cells',
      '/notebook read <path> <index|id> - read one notebook cell',
      '/notebook set <path> <index|id> <content> - replace one notebook cell',
      '/notebook add <path> <code|markdown|raw> <content> - insert a notebook cell',
      '/notebook delete <path> <index|id> - delete one notebook cell',
      '/teams - list local teams',
      '/team create <name> [member,member,...] - create a local team',
      '/team message <team> <from> <to|all> <text> - send a local team message',
      '/team inbox <team> [member] - inspect local team messages',
      '/team clear-inbox <team> [member] - clear stored team messages',
      '/team memory <team> scan - scan saved team memory for likely secrets',
      '/team memory <team> [show|set|append|sync] [text] - inspect or update team memory',
      '/team run <name> <prompt> - run all members of a team',
      '/team task <name> <prompt> - launch one background task per team member',
      '/chrome open <url> - open a URL in the local browser',
      '/chrome search <query> - open a browser search',
      '/chrome review <url> - fetch a page for quick review',
      '/bridges - list configured RoyCode bridge endpoints',
      '/remote-trigger - list saved remote triggers',
      '/remote-trigger add <name> <url> [POST|PUT] [token] - save a remote trigger',
      '/remote-trigger run <name> [json] - fire one remote trigger',
      '/bridge add <name> <url> [token] - register a remote RoyCode bridge',
      '/bridge run <name> <command> - execute a remote command through a bridge',
      '/marketplace - list self-hosted marketplace items',
      '/marketplace add <name> <auto|plugin|skill> <source> - register a marketplace item',
      '/marketplace install <name> - install a marketplace item',
      '/lsp diagnostics <path> - show TypeScript/JavaScript diagnostics',
      '/lsp defs <path> <line> <column> - go to definition',
      '/lsp impl <path> <line> <column> - go to implementation',
      '/lsp refs <path> <line> <column> - find references',
      '/lsp rename-preview <path> <line> <column> [newName] - preview rename targets',
      '/lsp rename-apply <path> <line> <column> <newName> - apply rename through safe-write or direct write',
      '/lsp hover <path> <line> <column> - show quick info',
      '/lsp symbols <path> - list document symbols',
      '/lsp workspace-symbols <query> - search symbols across the workspace',
      '/tasks - list background tasks',
      '/task start <prompt> - launch a background agent task',
      '/task show <id> - inspect one task',
      '/task logs <id> - print task logs',
      '/task output <id> - print the final task result if available',
      '/task stop <id> - request cancellation for one task',
      '/task retry <id> - restart one task from scratch',
      '/task update <id> <prompt> - update one task title and prompt',
      '/pending - list pending changes',
      '/apply <path|all> - apply pending changes',
      '/reject <path|all> - reject pending changes',
      '/git - show git status',
      '/git diff <path> - show git diff for one file',
      '/git stage [path] - stage one file or all changes',
      '/git unstage <path> - unstage one file',
      '/git commit <message> - create a commit',
      '/sessions - list saved CLI sessions',
      '/session [info|branch|summary|thinkback|export|resume|title|delete] - session workflow umbrella command',
      '/resume <id|latest> - resume a saved session',
      '/branch [title] - fork the current conversation into a new session',
      '/summary [instructions] - summarize the current conversation',
      '/thinkback - inspect saved session history and usage patterns',
      '/insights - alias for /thinkback',
      '/usage [today|7d|30d|days] - summarize recent RoyCode runs',
      '/cost [today|7d|30d|days] - estimate recent token cost from local usage logs',
      '/stats - inspect local runtime counts and recent activity',
      '/advisor <model>|off|status|review [text] - configure or run a second-opinion advisor model',
      '/suggest [show|run <index>|on|off|toggle|status] - inspect or use local next-prompt suggestions',
      '/notifications <on|off|toggle|status|test [text]> - configure local desktop notifications',
      '/notify <text> - send one local notification immediately',
      '/sleep-guard <on|off|toggle|status> - keep the machine awake locally when supported',
      '/settings-sync [status|export|import] - export or import RoyCode local settings bundles',
      '/security-review [notes] - run a focused security review against current changes',
      '/title <text> - rename the current session',
      '/rename <text> - alias for /title',
      '/delete-session <id|latest|current> - delete a saved session',
      '/new - start a fresh conversation in the current workspace',
      '/compact [instructions] - replace the current transcript with a compact summary',
      '/rewind [turns] - remove the last user turn(s) and following assistant replies',
      '/export [path|clipboard] - export the current session to markdown or json',
      '/clear - clear the terminal and reprint the banner',
      '/multiline - enter pasted block mode',
      '/exit - quit the CLI',
      '',
      '/review [task] - ask the agent for a review-focused pass',
      '/fix [task] - ask the agent to inspect and fix something',
      '/plan [task] - ask the agent for an implementation plan',
      '/explain [topic] - ask the agent to explain relevant code',
    ].join('\n') + '\n',
  )
  printDivider()
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    printMode: false,
    dangerouslySkipPermissions: false,
    attachments: [],
    listSessions: false,
    newSession: false,
    skills: [],
    appendSystemPrompts: [],
  }

  const readValue = (flag: string, index: number): string => {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`)
    }
    return value
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]

    switch (token) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--print':
      case '-p':
        options.prompt = readValue(token, index)
        options.printMode = true
        index += 1
        break
      case '--prompt':
        options.prompt = readValue(token, index)
        index += 1
        break
      case '--web-search':
        options.webSearchQuery = readValue(token, index)
        index += 1
        break
      case '--web-fetch':
        options.webFetchUrl = readValue(token, index)
        index += 1
        break
      case '--workspace':
        options.workspace = readValue(token, index)
        index += 1
        break
      case '--skill':
        options.skills.push(readValue(token, index))
        index += 1
        break
      case '--provider':
        options.provider = readValue(token, index)
        index += 1
        break
      case '--model':
        options.model = readValue(token, index)
        index += 1
        break
      case '--access': {
        const value = readValue(token, index).toLowerCase()
        if (value !== 'workspace' && value !== 'unrestricted') {
          throw new Error('Expected --access workspace|unrestricted')
        }
        options.access = value
        index += 1
        break
      }
      case '--dangerously-skip-permissions':
      case '--full-access':
        options.dangerouslySkipPermissions = true
        break
      case '--safe-write':
        options.safeWriteMode = true
        break
      case '--unsafe-write':
        options.safeWriteMode = false
        break
      case '--cwd':
        options.cwd = readValue(token, index)
        index += 1
        break
      case '--attach':
        options.attachments.push(readValue(token, index))
        index += 1
        break
      case '--allowedTools':
      case '--allowed-tools':
        options.allowedTools = readValue(token, index)
        index += 1
        break
      case '--append-system-prompt':
        options.appendSystemPrompts.push(readValue(token, index))
        index += 1
        break
      case '--output-format':
        options.outputFormat = readValue(token, index)
        index += 1
        break
      case '--resume': {
        const next = argv[index + 1]
        if (!next || next.startsWith('--')) {
          options.resume = 'latest'
        } else {
          options.resume = next
          index += 1
        }
        break
      }
      case '--list-sessions':
        options.listSessions = true
        break
      case '--title':
        options.title = readValue(token, index)
        index += 1
        break
      case '--new':
        options.newSession = true
        break
      default:
        throw new Error(`Unknown option: ${token}`)
    }
  }

  return options
}

async function updateSettings(
  state: CliState,
  updater: (settings: AppSettings) => AppSettings,
): Promise<void> {
  const nextSettings = updater(state.settings)
  await writeSettings(nextSettings)
  state.settings = nextSettings
  state.sessionTouched = true
  await saveCurrentSession(state)
}

async function findSessionRecord(reference: string): Promise<CliSessionRecord | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized || normalized === 'latest') {
    return getLatestCliSession()
  }

  const sessions = await listCliSessions()

  return (
    sessions.find(session => session.id === reference) ??
    sessions.find(session => session.id.startsWith(reference)) ??
    sessions.find(session => session.title.toLowerCase() === normalized) ??
    sessions.find(session => session.title.toLowerCase().includes(normalized)) ??
    null
  )
}

async function loadSessionIntoState(
  state: CliState,
  reference: string,
): Promise<CliSessionRecord | null> {
  const record = await findSessionRecord(reference)
  if (!record) {
    return null
  }

  const provider = findProvider(state.settings, record.providerId)
  const nextSettings: AppSettings = {
    ...state.settings,
    workspaceRoot: record.workspaceRoot,
    accessMode: record.accessMode,
    safeWriteMode: record.safeWriteMode,
    selectedProviderId: provider?.id ?? state.settings.selectedProviderId,
    selectedModel: record.model || state.settings.selectedModel,
  }

  await writeSettings(nextSettings)

  state.settings = nextSettings
  state.cwd = record.cwd || '.'
  state.messages = cloneMessages(record.messages)
  state.pendingAttachments = []
  state.activeSkills = [...(record.activeSkills ?? [])]
  state.compactSummaries = [...(record.compactSummaries ?? [])]
  state.lastSuggestions = []
  state.sessionId = record.id
  state.sessionTitle = record.title || 'New session'
  state.sessionCreatedAt = record.createdAt
  state.explicitTitle = record.title !== 'New session' || record.messages.length > 0
  state.sessionTouched = record.messages.length > 0 || state.explicitTitle
  state.executionMode = record.executionMode ?? 'default'
  state.planFocus = record.planFocus
  state.worktreeBaseRoot = record.worktreeBaseRoot
  state.activeWorktreePath = record.activeWorktreePath

  return record
}

function startFreshSession(state: CliState): void {
  state.messages = []
  state.pendingAttachments = []
  state.activeSkills = []
  state.compactSummaries = []
  state.lastSuggestions = []
  state.sessionId = createSessionId()
  state.sessionTitle = 'New session'
  state.sessionCreatedAt = new Date().toISOString()
  state.explicitTitle = false
  state.sessionTouched = false
  state.executionMode = 'default'
  state.planFocus = undefined
  state.worktreeBaseRoot = undefined
  state.activeWorktreePath = undefined
}

function printProviders(state: CliState): void {
  const current = getSelectedProvider(state.settings)
  for (const provider of state.settings.providers) {
    const marker = provider.id === current.id ? green('*') : dim('-')
    process.stdout.write(
      `${marker} ${provider.id} ${dim(`(${provider.name})`)} ${provider.apiKey ? green('key') : red('no-key')} ${dim(provider.baseUrl)}\n`,
    )
  }
}

function printModels(state: CliState): void {
  const provider = getSelectedProvider(state.settings)
  const currentModel = resolveModel(state.settings, provider)
  for (const model of provider.models) {
    const marker = model === currentModel ? green('*') : dim('-')
    process.stdout.write(`${marker} ${model}\n`)
  }
}

function printAttachments(attachments: CliAttachment[]): void {
  if (!attachments.length) {
    info('No queued attachments')
    return
  }

  for (const attachment of attachments) {
    process.stdout.write(
      `${dim('-')} ${attachment.path}${attachment.truncated ? dim(' [truncated]') : ''}\n`,
    )
  }
}

function printHooksList(
  hooks: Array<{ id: string; event: HookEventName; command: string; enabled: boolean; matcher?: string }>,
): void {
  if (!hooks.length) {
    info('No hooks configured')
    return
  }

  for (const hook of hooks) {
    process.stdout.write(
      `${hook.enabled ? green('*') : dim('-')} ${hook.id} ${dim(`[${hook.event}]`)} ${truncate(hook.command, 160)}${hook.matcher ? ` ${dim(`match=${hook.matcher}`)}` : ''}${hook.enabled ? '' : dim(' [disabled]')}\n`,
    )
  }
}

function printSkillList(
  skills: Array<{ name: string; summary: string; source?: string }>,
  activeSkills: string[],
): void {
  if (!skills.length) {
    info(
      'No local skills found. RoyCode auto-loads project .claude/skills, user ~/.claude/skills, and imported local skills.',
    )
    return
  }

  const active = new Set(activeSkills.map(item => item.toLowerCase()))
  for (const skill of skills) {
    const marker = active.has(skill.name.toLowerCase()) ? green('*') : dim('-')
    const sourceLabel = skill.source ? ` ${dim(`[${skill.source}]`)}` : ''
    process.stdout.write(`${marker} ${skill.name}${sourceLabel} ${dim(skill.summary)}\n`)
  }
}

function printCompatCommandList(
  localCommands: Array<{ name: string; summary: string; source?: string }>,
  pluginCommands: Array<{ name: string; description: string; pluginName?: string }>,
): void {
  if (!localCommands.length && !pluginCommands.length) {
    info('No Claude-style slash commands found.')
    return
  }

  if (localCommands.length) {
    process.stdout.write(`${label('Local Claude Commands')}\n`)
    for (const command of localCommands) {
      const sourceLabel = command.source ? ` ${dim(`[${command.source}]`)}` : ''
      process.stdout.write(`- ${command.name}${sourceLabel} ${dim(command.summary)}\n`)
    }
  }

  if (pluginCommands.length) {
    if (localCommands.length) {
      process.stdout.write('\n')
    }
    process.stdout.write(`${label('Plugin Commands')}\n`)
    for (const command of pluginCommands) {
      process.stdout.write(`- ${command.name} ${dim(command.description)}\n`)
    }
  }
}

function printAgentList(
  agents: LocalAgentDefinition[],
): void {
  if (!agents.length) {
    info('No local subagents found. RoyCode auto-loads project and user .claude/agents.')
    return
  }

  for (const agent of agents) {
    const sourceLabel = agent.source ? ` ${dim(`[${agent.source}]`)}` : ''
    process.stdout.write(`- ${agent.name}${sourceLabel} ${dim(agent.description)}\n`)
  }
}

function printPluginList(
  plugins: Array<{ name: string; description: string; enabled: boolean; version?: string }>,
): void {
  if (!plugins.length) {
    info('No local plugins found. Use /plugin import <path> [name] to add one.')
    return
  }

  for (const plugin of plugins) {
    const marker = plugin.enabled ? green('*') : dim('-')
    const version = plugin.version ? ` v${plugin.version}` : ''
    process.stdout.write(`${marker} ${plugin.name}${version} ${dim(plugin.description)}\n`)
  }
}

function printPluginCommandList(
  commands: Array<{
    name: string
    description: string
    argumentHint?: string
    kind?: string
  }>,
): void {
  if (!commands.length) {
    info('No plugin commands found')
    return
  }

  for (const command of commands) {
    const suffix = command.argumentHint ? ` ${dim(`args: ${command.argumentHint}`)}` : ''
    const kind = command.kind ? `${dim(`[${command.kind}]`)} ` : ''
    process.stdout.write(`${kind}${command.name} ${dim(command.description)}${suffix}\n`)
  }
}

function printMcpServerList(servers: LocalMcpServerConfig[]): void {
  if (!servers.length) {
    info('No MCP servers configured')
    return
  }

  for (const server of servers) {
    const marker = server.enabled ? green('*') : dim('-')
    const details =
      server.transport === 'stdio'
        ? `${server.command}${server.args.length ? ` ${server.args.join(' ')}` : ''}`
        : server.url
    process.stdout.write(
      `${marker} ${server.name} ${dim(`[${server.transport}]`)}${server.source ? ` ${dim(`[${server.source}]`)}` : ''} ${dim(details)}\n`,
    )
  }
}

function printTaskList(
  tasks: Array<{
    id: string
    title: string
    status: string
    updatedAt: string
    workspaceRoot: string
  }>,
): void {
  if (!tasks.length) {
    info('No background tasks')
    return
  }

  for (const task of tasks) {
    process.stdout.write(
      `${task.id} ${dim(`[${task.status}]`)} ${task.title}\n   ${dim(task.workspaceRoot)} ${dim(task.updatedAt)}\n`,
    )
  }
}

function printTaskDetails(task: {
  id: string
  title: string
  prompt: string
  status: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  workspaceRoot: string
  cwd: string
  providerId: string
  model: string
  runnerPid?: number
  result?: string
  error?: string
}): void {
  printDivider()
  process.stdout.write(`${label(task.title)} ${dim(task.id)}\n`)
  process.stdout.write(
    [
      `${label('status')} ${task.status}`,
      `${label('workspace')} ${task.workspaceRoot}`,
      `${label('cwd')} ${task.cwd}`,
      `${label('provider')} ${task.providerId}`,
      `${label('model')} ${task.model}`,
      `${label('created')} ${task.createdAt}`,
      `${label('updated')} ${task.updatedAt}`,
      `${label('started')} ${task.startedAt || '(not started)'}`,
      `${label('finished')} ${task.finishedAt || '(not finished)'}`,
      `${label('runner')} ${
        typeof task.runnerPid === 'number' ? String(task.runnerPid) : '(none)'
      }`,
    ].join(` ${dim('|')} `) + '\n',
  )
  process.stdout.write(`\n${label('prompt')}\n${task.prompt}\n`)
  if (task.error) {
    process.stdout.write(`\n${red('error')} ${task.error}\n`)
  }
  if (task.result) {
    process.stdout.write(`\n${task.result}\n`)
  }
  printDivider()
}

function parseCommandTarget(rawArgs: string): { action: string; rest: string } {
  const trimmed = rawArgs.trim()
  if (!trimmed) {
    return { action: '', rest: '' }
  }
  const firstSpace = trimmed.indexOf(' ')
  if (firstSpace === -1) {
    return { action: trimmed.toLowerCase(), rest: '' }
  }
  return {
    action: trimmed.slice(0, firstSpace).toLowerCase(),
    rest: trimmed.slice(firstSpace + 1).trim(),
  }
}

function tokenizeQuotedArgs(raw: string): string[] {
  const tokens = raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  return tokens.map(token => stripWrappingQuotes(token))
}

function parseOptionalJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {}
  }
  const parsed = JSON.parse(trimmed) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Expected a JSON object')
  }
  return parsed as Record<string, unknown>
}

function formatJsonValue(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value, null, 2)
}

function parseConfigLiteral(raw: string): string | number | boolean {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }
  if (/^(true|false)$/i.test(trimmed)) {
    return trimmed.toLowerCase() === 'true'
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return stripWrappingQuotes(trimmed)
  }
  return trimmed
}

function parseHookCommandSpec(raw: string): {
  matcher?: string
  command: string
} {
  const tokens = tokenizeQuotedArgs(raw)
  const matcherIndex = tokens.findIndex(token => token === '--match')
  if (matcherIndex < 0) {
    return { command: raw.trim() }
  }

  const matcher = tokens[matcherIndex + 1]
  const before = tokens.slice(0, matcherIndex)
  const after = tokens.slice(matcherIndex + 2)
  return {
    matcher,
    command: [...before, ...after].join(' ').trim(),
  }
}

function resolveSessionTodoId(state: CliState): string {
  return state.sessionId
}

function printRuleList(rules: LocalRuleDocument[]): void {
  if (!rules.length) {
    info('No Claude-style rules matched the current workspace and cwd')
    return
  }

  for (const rule of rules) {
    const pathInfo = rule.paths?.length ? ` ${dim(`[paths: ${rule.paths.join(', ')}]`)}` : ''
    process.stdout.write(
      `- ${rule.name} ${dim(`[${rule.source}]`)}${pathInfo} ${dim(rule.description)}\n`,
    )
  }
}

function printOutputStyleDocs(
  styles: Array<{
    name: string
    description: string
    source: string
  }>,
): void {
  if (!styles.length) {
    info('No custom Claude-style output styles found')
    return
  }

  for (const style of styles) {
    process.stdout.write(
      `- ${style.name} ${dim(`[${style.source}]`)} ${dim(style.description)}\n`,
    )
  }
}

function printAvailableOutputStylesList(
  styles: Array<{
    name: string
    description: string
    source: string
  }>,
  currentStyle: string,
): void {
  const normalizedCurrent = currentStyle.toLowerCase()
  const defaultMarker =
    normalizedCurrent === DEFAULT_OUTPUT_STYLE_NAME ? green('*') : dim('-')
  process.stdout.write(
    `${defaultMarker} ${DEFAULT_OUTPUT_STYLE_NAME} ${dim('[built-in]')} ${dim('RoyCode default output behavior')}\n`,
  )
  for (const style of styles) {
    const marker = style.name.toLowerCase() === normalizedCurrent ? green('*') : dim('-')
    process.stdout.write(
      `${marker} ${style.name} ${dim(`[${style.source}]`)} ${dim(style.description)}\n`,
    )
  }
}

function printTodoList(todos: TodoItem[]): void {
  if (!todos.length) {
    info('No session todos')
    return
  }

  for (const todo of todos) {
    const status =
      todo.status === 'completed' ? green(todo.status) : todo.status === 'in_progress' ? yellow(todo.status) : dim(todo.status)
    const note = todo.note ? ` ${dim(`(${todo.note})`)}` : ''
    process.stdout.write(`- [${status}] ${todo.content}${note}\n`)
  }
}

function printKeyValueBlock(
  title: string,
  entries: Array<{ label: string; value: string }>,
): void {
  process.stdout.write(`${label(title)}\n`)
  for (const entry of entries) {
    process.stdout.write(`- ${entry.label}: ${entry.value}\n`)
  }
}

function printTeamMessages(
  messages: Array<{
    from: string
    to: string
    content: string
    createdAt: string
  }>,
): void {
  if (!messages.length) {
    info('No team messages')
    return
  }

  for (const message of messages) {
    process.stdout.write(
      `- [${message.createdAt}] ${message.from} -> ${message.to}: ${message.content}\n`,
    )
  }
}

function printWorktreeList(
  worktrees: Array<{
    path: string
    branch?: string
    detached?: boolean
    locked?: boolean
    prunable?: boolean
  }>,
  currentWorkspaceRoot?: string,
): void {
  if (!worktrees.length) {
    info('No git worktrees found')
    return
  }

  const normalizedCurrent = currentWorkspaceRoot?.toLowerCase()
  for (const worktree of worktrees) {
    const marker = normalizedCurrent === worktree.path.toLowerCase() ? green('*') : dim('-')
    const flags = [
      worktree.branch ? `branch=${worktree.branch}` : '',
      worktree.detached ? 'detached' : '',
      worktree.locked ? 'locked' : '',
      worktree.prunable ? 'prunable' : '',
    ]
      .filter(Boolean)
      .join(', ')
    process.stdout.write(
      `${marker} ${worktree.path}${flags ? ` ${dim(`[${flags}]`)}` : ''}\n`,
    )
  }
}

function printWorktreeDetails(worktree: {
  path: string
  branch?: string
  head?: string
  detached?: boolean
  locked?: boolean
  prunable?: boolean
  current?: boolean
  statusSummary?: string
  changedFiles?: number
}): void {
  printKeyValueBlock(`Worktree ${worktree.path}`, [
    { label: 'branch', value: worktree.branch || '(detached)' },
    { label: 'head', value: worktree.head || '(unknown)' },
    { label: 'current', value: worktree.current ? 'yes' : 'no' },
    { label: 'detached', value: worktree.detached ? 'yes' : 'no' },
    { label: 'locked', value: worktree.locked ? 'yes' : 'no' },
    { label: 'prunable', value: worktree.prunable ? 'yes' : 'no' },
    { label: 'status', value: worktree.statusSummary || '(unknown)' },
    { label: 'changed-files', value: String(worktree.changedFiles ?? 0) },
  ])
}

function printCronTaskList(tasks: Array<{
  id: string
  cron: string
  prompt: string
  recurring?: boolean
  nextRunAt?: string | null
}>): void {
  if (!tasks.length) {
    info('No scheduled local prompts in this workspace')
    return
  }

  for (const task of tasks) {
    process.stdout.write(
      `${dim('-')} ${task.id} ${dim(`(${cronToHuman(task.cron)})`)} ${task.recurring === false ? yellow('once') : green('repeat')}\n`,
    )
    process.stdout.write(
      `    ${truncate(task.prompt, 120)}${task.nextRunAt ? dim(` | next ${task.nextRunAt}`) : ''}\n`,
    )
  }
}

function parseLineColumnArgs(tokens: string[]): { line: number; column: number } {
  const line = Number.parseInt(tokens[0] || '1', 10)
  const column = Number.parseInt(tokens[1] || '1', 10)
  if (!Number.isFinite(line) || line < 1 || !Number.isFinite(column) || column < 1) {
    throw new Error('Line and column must be positive integers')
  }
  return { line, column }
}

function normalizeAgentMemoryScope(raw: string): AgentMemoryScope | null {
  const normalized = raw.trim().toLowerCase()
  if (normalized === 'user' || normalized === 'project' || normalized === 'local') {
    return normalized
  }
  return null
}

function buildHookContext(
  state: CliState,
  extra: Partial<{
    prompt: string
    assistant: string
    toolName: string
    toolInput: string
    toolOutput: string
    commandName: string
    commandArgs: string
    taskId: string
    taskTitle: string
    taskStatus: string
    agentName: string
    configKey: string
    configValue: string
  }> = {},
): {
  workspaceRoot: string
  cwd: string
  accessMode: AccessMode
  timeoutMs: number
  sessionId: string
  sessionTitle: string
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
} {
  return {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    timeoutMs: Math.min(state.settings.commandTimeoutMs, 15_000),
    sessionId: state.sessionId,
    sessionTitle: state.sessionTitle,
    ...extra,
  }
}

async function runHookSafely(
  event: HookEventName,
  state: CliState,
  extra: Partial<{
    prompt: string
    assistant: string
    toolName: string
    toolInput: string
    toolOutput: string
    commandName: string
    commandArgs: string
    taskId: string
    taskTitle: string
    taskStatus: string
    agentName: string
    configKey: string
    configValue: string
  }> = {},
): Promise<{
  continue: boolean
  stopReason?: string
  additionalContext?: string
  updatedInput?: string
}> {
  try {
    const result = await runHook(event, buildHookContext(state, extra))
    if (result.systemMessage) {
      process.stdout.write(`${dim(`[hook:${event}] ${result.systemMessage}`)}\n`)
    }
    if (result.displayOutput) {
      process.stdout.write(
        `${dim(`[hook:${event}] ${truncate(result.displayOutput.replace(/\s+/g, ' '), 180)}`)}\n`,
      )
    }
    return {
      continue: result.continue,
      stopReason: result.stopReason,
      additionalContext: result.additionalContext,
      updatedInput: result.updatedInput,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown hook error'
    warn(`Hook ${event} failed: ${message}`)
    return { continue: true }
  }
}

async function resolveActiveSkillNames(
  names: string[],
  workspaceRoot: string,
  cwd: string,
): Promise<{ active: string[]; missing: string[] }> {
  const active: string[] = []
  const missing: string[] = []
  for (const name of names) {
    const normalized = name.trim().toLowerCase()
    if (!normalized) {
      continue
    }
    const skill = await getLocalSkill(normalized, workspaceRoot, cwd)
    if (skill) {
      if (!active.includes(skill.name)) {
        active.push(skill.name)
      }
    } else {
      missing.push(name)
    }
  }
  return { active, missing }
}

function formatTree(nodes: FileNode[], prefix = ''): string[] {
  const lines: string[] = []
  nodes.forEach((node, index) => {
    const isLast = index === nodes.length - 1
    const branch = isLast ? '\\-- ' : '|-- '
    const childPrefix = `${prefix}${isLast ? '    ' : '|   '}`
    lines.push(`${prefix}${branch}${node.name}${node.type === 'directory' ? '/' : ''}`)
    if (node.children?.length) {
      lines.push(...formatTree(node.children, childPrefix))
    }
  })
  return lines
}

function parsePathAndDepth(rawArgs: string): { requestedPath: string; depth: number } {
  const trimmed = rawArgs.trim()
  if (!trimmed) {
    return { requestedPath: '.', depth: 2 }
  }

  const match = trimmed.match(/^(.*?)(?:\s+(\d+))?$/)
  const requestedPath = stripWrappingQuotes(match?.[1] || '.') || '.'
  const parsedDepth = Number(match?.[2] ?? 2)
  return {
    requestedPath,
    depth: Number.isFinite(parsedDepth) ? Math.max(0, Math.min(4, parsedDepth)) : 2,
  }
}

function formatTextPreview(text: string): string {
  const lines = text.split(/\r?\n/).slice(0, MAX_FILE_PREVIEW_LINES)
  let output = lines
    .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n')

  if (output.length > MAX_FILE_PREVIEW_CHARS) {
    output = `${output.slice(0, MAX_FILE_PREVIEW_CHARS)}\n...[truncated]`
  } else if (text.split(/\r?\n/).length > MAX_FILE_PREVIEW_LINES) {
    output = `${output}\n...[truncated]`
  }

  return output
}

function printPendingChanges(changes: PendingChange[]): void {
  if (!changes.length) {
    info('No pending changes')
    return
  }

  for (const change of changes) {
    process.stdout.write(
      `${magenta(change.source === 'agent' ? 'agent' : 'manual')} ${change.path} ${dim(change.updatedAt)}\n`,
    )
  }
}

async function handleProviderCommand(state: CliState, rawArgs: string): Promise<void> {
  if (!rawArgs) {
    printProviders(state)
    return
  }

  const provider = findProvider(state.settings, rawArgs)
  if (!provider) {
    fail(`Provider not found: ${rawArgs}`)
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    selectedProviderId: provider.id,
    selectedModel: provider.defaultModel ?? provider.models[0] ?? settings.selectedModel,
  }))
  ok(`Switched provider to ${provider.name}`)
}

async function handleModelCommand(state: CliState, rawArgs: string): Promise<void> {
  const provider = getSelectedProvider(state.settings)
  if (!rawArgs) {
    printModels(state)
    return
  }

  const model =
    provider.models.find(item => item === rawArgs) ??
    provider.models.find(item => item.toLowerCase() === rawArgs.toLowerCase()) ??
    provider.models.find(item => item.toLowerCase().includes(rawArgs.toLowerCase()))

  if (!model) {
    fail(`Model not found under ${provider.name}: ${rawArgs}`)
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    selectedModel: model,
  }))
  ok(`Switched model to ${model}`)
}

async function handleWorkspaceCommand(state: CliState, rawArgs: string): Promise<void> {
  const nextRoot = stripWrappingQuotes(rawArgs)
  if (!nextRoot) {
    fail('Usage: /workspace <path>')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    workspaceRoot: path.resolve(nextRoot),
  }))
  await registerCronWorkspace(state.settings.workspaceRoot)
  state.cwd = '.'
  await saveCurrentSession(state)
  const instructionFiles = await listWorkspaceInstructionFiles(
    state.settings.workspaceRoot,
    state.settings.accessMode,
    state.cwd,
  )
  await runHookSafely('instructions-loaded', state, {
    commandArgs: instructionFiles.map(file => file.path).join(', '),
  })
  ok(`Workspace root set to ${state.settings.workspaceRoot}`)
}

async function handleAccessCommand(state: CliState, rawArgs: string): Promise<void> {
  const nextMode = rawArgs.trim().toLowerCase()
  if (nextMode !== 'workspace' && nextMode !== 'unrestricted') {
    fail('Usage: /access <workspace|unrestricted>')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    accessMode: nextMode,
  }))
  ok(`Filesystem access mode set to ${nextMode}`)
}

async function handlePermissionsCommand(state: CliState, rawArgs: string): Promise<void> {
  const preset = rawArgs.trim().toLowerCase()
  if (!preset) {
    info(
      `Current preset: ${state.settings.accessMode === 'unrestricted' && !state.settings.safeWriteMode ? 'full' : state.settings.accessMode === 'unrestricted' ? 'safe' : 'workspace'}`,
    )
    info('Usage: /permissions <full|safe|workspace>')
    return
  }

  if (preset === 'full' || preset === 'danger' || preset === 'dangerous') {
    await updateSettings(state, settings => ({
      ...settings,
      accessMode: 'unrestricted',
      safeWriteMode: false,
    }))
    ok('Permission preset set to full access')
    return
  }

  if (preset === 'safe') {
    await updateSettings(state, settings => ({
      ...settings,
      accessMode: 'unrestricted',
      safeWriteMode: true,
    }))
    ok('Permission preset set to unrestricted access with safe-write on')
    return
  }

  if (preset === 'workspace' || preset === 'default') {
    await updateSettings(state, settings => ({
      ...settings,
      accessMode: 'workspace',
      safeWriteMode: true,
    }))
    ok('Permission preset set to workspace mode')
    return
  }

  fail('Usage: /permissions <full|safe|workspace>')
}

async function handleSafeWriteCommand(state: CliState, rawArgs: string): Promise<void> {
  const value = rawArgs.trim().toLowerCase()
  if (!['on', 'off', 'true', 'false'].includes(value)) {
    fail('Usage: /safe-write <on|off>')
    return
  }

  const enabled = value === 'on' || value === 'true'
  await updateSettings(state, settings => ({
    ...settings,
    safeWriteMode: enabled,
  }))
  ok(`Safe write mode ${enabled ? 'enabled' : 'disabled'}`)
}

async function handleCwdCommand(state: CliState, rawArgs: string): Promise<void> {
  const nextCwd = stripWrappingQuotes(rawArgs)
  if (!nextCwd) {
    fail('Usage: /cwd <path>')
    return
  }

  state.cwd = nextCwd
  state.sessionTouched = true
  await saveCurrentSession(state)
  const instructionFiles = await listWorkspaceInstructionFiles(
    state.settings.workspaceRoot,
    state.settings.accessMode,
    state.cwd,
  )
  await runHookSafely('instructions-loaded', state, {
    commandArgs: instructionFiles.map(file => file.path).join(', '),
  })
  ok(`Default cwd set to ${nextCwd}`)
}

async function handleAttachCommand(state: CliState, rawArgs: string): Promise<void> {
  const targetPath = stripWrappingQuotes(rawArgs)
  if (!targetPath) {
    fail('Usage: /attach <path>')
    return
  }

  const content = await readWorkspaceFile(
    state.settings.workspaceRoot,
    targetPath,
    state.settings.accessMode,
  )
  const truncated = content.length > MAX_ATTACHMENT_CHARS
  state.pendingAttachments.push({
    path: targetPath,
    content: truncated ? `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]` : content,
    truncated,
  })
  ok(`Attached ${targetPath} to the next prompt`)
}

async function handleFilesCommand(state: CliState, rawArgs: string): Promise<void> {
  const { requestedPath, depth } = parsePathAndDepth(rawArgs)
  const tree = await buildFileTree(
    state.settings.workspaceRoot,
    requestedPath,
    depth,
    state.settings.accessMode,
  )

  process.stdout.write(`${label('Files')} ${requestedPath} ${dim(`(depth ${depth})`)}\n`)
  const lines = formatTree(tree)
  process.stdout.write(`${lines.join('\n') || dim('(empty)')}\n`)
}

async function handleReadCommand(state: CliState, rawArgs: string): Promise<void> {
  const targetPath = stripWrappingQuotes(rawArgs)
  if (!targetPath) {
    fail('Usage: /read <path>')
    return
  }

  const content = await readWorkspaceFile(
    state.settings.workspaceRoot,
    targetPath,
    state.settings.accessMode,
  )
  printDivider()
  process.stdout.write(`${label(targetPath)}\n`)
  process.stdout.write(`${formatTextPreview(content)}\n`)
  printDivider()
}

async function handleSearchCommand(state: CliState, rawArgs: string): Promise<void> {
  const query = rawArgs.trim()
  if (!query) {
    fail('Usage: /search <query>')
    return
  }

  const results = await searchWorkspace(
    state.settings.workspaceRoot,
    query,
    '.',
    30,
    state.settings.accessMode,
  )

  if (!results.length) {
    info(`No matches for "${query}"`)
    return
  }

  for (const result of results) {
    process.stdout.write(`${result.path}:${result.line} ${dim(result.preview)}\n`)
  }
}

async function handleWebSearchCommand(rawArgs: string): Promise<void> {
  const query = rawArgs.trim()
  if (!query) {
    fail('Usage: /web-search <query>')
    return
  }

  const results = await webSearch({ query, maxResults: 8 })
  if (!results.length) {
    info(`No web results for "${query}"`)
    return
  }

  for (const [index, result] of results.entries()) {
    process.stdout.write(
      `${index + 1}. ${result.title}\n   ${result.url}\n   ${dim(result.snippet || result.domain)}\n`,
    )
  }
}

async function handleWebFetchCommand(rawArgs: string): Promise<void> {
  const url = stripWrappingQuotes(rawArgs)
  if (!url) {
    fail('Usage: /web-fetch <url>')
    return
  }

  const result = await webFetch(url)
  printDivider()
  process.stdout.write(`${label(result.title)}\n`)
  process.stdout.write(`${dim(result.url)}\n`)
  process.stdout.write(`${dim(result.contentType)}\n\n`)
  process.stdout.write(`${result.text}\n`)
  printDivider()
}

async function handleRunCommand(state: CliState, rawArgs: string): Promise<void> {
  const command = rawArgs.trim()
  if (!command) {
    fail('Usage: /run <command>')
    return
  }

  const output = await runWorkspaceCommand(
    state.settings.workspaceRoot,
    command,
    state.cwd,
    state.settings.commandTimeoutMs,
    state.settings.accessMode,
  )
  printDivider()
  process.stdout.write(`${output}\n`)
  printDivider()
}

async function handlePendingCommand(rawArgs: string): Promise<void> {
  const changes = await listPendingChanges()
  const filter = rawArgs.trim().toLowerCase()
  if (!filter) {
    printPendingChanges(changes)
    return
  }

  const filtered = changes.filter(change => change.path.toLowerCase().includes(filter))
  printPendingChanges(filtered)
}

async function handleApplyCommand(state: CliState, rawArgs: string): Promise<void> {
  const target = rawArgs.trim()
  if (!target) {
    fail('Usage: /apply <path|all>')
    return
  }

  if (target.toLowerCase() === 'all') {
    const applied = await applyAllPendingChanges(
      state.settings.workspaceRoot,
      state.settings.accessMode,
    )
    ok(`Applied ${applied.length} pending changes`)
    return
  }

  const change = await applyPendingChange(
    state.settings.workspaceRoot,
    target,
    state.settings.accessMode,
  )
  ok(`Applied ${change.path}`)
}

async function handleRejectCommand(state: CliState, rawArgs: string): Promise<void> {
  const target = rawArgs.trim()
  if (!target) {
    fail('Usage: /reject <path|all>')
    return
  }

  if (target.toLowerCase() === 'all') {
    const changes = await listPendingChanges()
    for (const change of changes) {
      await discardPendingChange(
        state.settings.workspaceRoot,
        change.path,
        state.settings.accessMode,
      )
    }
    ok(`Rejected ${changes.length} pending changes`)
    return
  }

  await discardPendingChange(
    state.settings.workspaceRoot,
    target,
    state.settings.accessMode,
  )
  ok(`Rejected ${target}`)
}

async function handleGitCommand(state: CliState, rawArgs: string): Promise<void> {
  const trimmed = rawArgs.trim()
  const firstSpace = trimmed.indexOf(' ')
  const subcommand = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase()
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim()

  if (!trimmed || subcommand === 'status') {
    const status = await getGitStatus(state.settings.workspaceRoot)
    if (!status.isRepo) {
      warn('Current workspace is not a git repository')
      return
    }

    process.stdout.write(
      [
        `${label('branch')} ${status.branch}`,
        `${label('ahead')} ${status.ahead}`,
        `${label('behind')} ${status.behind}`,
        `${label('staged')} ${status.stagedCount}`,
        `${label('unstaged')} ${status.unstagedCount}`,
        `${label('untracked')} ${status.untrackedCount}`,
      ].join(` ${dim('|')} `) + '\n',
    )

    for (const file of status.files.slice(0, 30)) {
      process.stdout.write(
        `${file.staged ? green('S') : dim('-')}${file.unstaged ? colorize('U', YELLOW) : dim('-')} ${file.path}\n`,
      )
    }

    if (status.files.length > 30) {
      info(`...and ${status.files.length - 30} more changed files`)
    }
    return
  }

  if (subcommand === 'diff') {
    if (!rest) {
      fail('Usage: /git diff <path>')
      return
    }

    const diff = await getGitDiff(state.settings.workspaceRoot, stripWrappingQuotes(rest))
    printDivider()
    process.stdout.write(`${label(diff.path)}\n`)
    if (diff.unstagedDiff.trim()) {
      process.stdout.write(`${dim('[unstaged]')}\n${diff.unstagedDiff}\n`)
    }
    if (diff.stagedDiff.trim()) {
      process.stdout.write(`${dim('[staged]')}\n${diff.stagedDiff}\n`)
    }
    if (!diff.unstagedDiff.trim() && !diff.stagedDiff.trim()) {
      info('No diff for that file')
    }
    printDivider()
    return
  }

  if (subcommand === 'stage') {
    await stageGitFile(
      state.settings.workspaceRoot,
      rest ? stripWrappingQuotes(rest) : undefined,
    )
    ok(rest ? `Staged ${rest}` : 'Staged all changes')
    return
  }

  if (subcommand === 'unstage') {
    if (!rest) {
      fail('Usage: /git unstage <path>')
      return
    }
    await unstageGitFile(state.settings.workspaceRoot, stripWrappingQuotes(rest))
    ok(`Unstaged ${rest}`)
    return
  }

  if (subcommand === 'commit') {
    if (!rest) {
      fail('Usage: /git commit <message>')
      return
    }

    const result = await commitGitChanges(state.settings.workspaceRoot, rest)
    ok(truncate(result.summary.replace(/\s+/g, ' '), 200))
    return
  }

  fail('Usage: /git [status|diff <path>|stage [path]|unstage <path>|commit <message>]')
}

async function handleCronCommand(state: CliState, rawArgs: string): Promise<void> {
  await registerCronWorkspace(state.settings.workspaceRoot)
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action || action === 'list') {
    const tasks = await listCronTasks(state.settings.workspaceRoot)
    printCronTaskList(tasks)
    return
  }

  if (action === 'add' || action === 'create') {
    const tokens = tokenizeQuotedArgs(rest)
    const cron = tokens.shift()
    if (!cron) {
      fail('Usage: /cron add "<cron>" "<prompt>" [--once]')
      return
    }
    const recurring = !tokens.includes('--once')
    const prompt = tokens.filter(token => !token.startsWith('--')).join(' ').trim()
    if (!prompt) {
      fail('Usage: /cron add "<cron>" "<prompt>" [--once]')
      return
    }
    const provider = getSelectedProvider(state.settings)
    const task = await createCronTask({
      cron,
      prompt,
      recurring,
      workspaceRoot: state.settings.workspaceRoot,
      accessMode: state.settings.accessMode,
      safeWriteMode: state.settings.safeWriteMode,
      providerId: provider.id,
      model: resolveModel(state.settings, provider),
      cwd: state.cwd,
    })
    await startCronScheduler([state.settings.workspaceRoot])
    ok(
      `Scheduled ${task.id} ${dim(`(${cronToHuman(task.cron)})`)} ${task.recurring === false ? 'once' : 'recurring'}`,
    )
    return
  }

  if (action === 'remove' || action === 'delete') {
    const reference = stripWrappingQuotes(rest).trim()
    if (!reference) {
      fail('Usage: /cron remove <id>')
      return
    }
    const deleted = await deleteCronTask(state.settings.workspaceRoot, reference)
    if (!deleted) {
      fail(`Scheduled task not found: ${reference}`)
      return
    }
    ok(`Removed scheduled task ${deleted.id}`)
    return
  }

  if (action === 'run-due' || action === 'tick') {
    const summary = await runDueCronTasks([state.settings.workspaceRoot])
    if (!summary.firedCount) {
      info('No scheduled prompts are due right now')
    } else {
      ok(`Triggered ${summary.firedCount} scheduled prompt(s)`)
    }
    if (summary.errors.length) {
      summary.errors.forEach(item => warn(item))
    }
    return
  }

  fail('Usage: /cron [list|add "<cron>" "<prompt>" [--once]|remove <id>|run-due]')
}

async function handlePlanModeCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action || action === 'status') {
    info(`Execution mode: ${describeExecutionMode(state)}`)
    return
  }

  if (action === 'enter' || action === 'on') {
    if (state.executionMode === 'worktree') {
      warn('Exit worktree mode first if you want a pure plan session.')
      return
    }
    state.executionMode = 'plan'
    state.planFocus = rest.trim() || undefined
    state.sessionTouched = true
    await saveCurrentSession(state)
    ok(
      state.planFocus
        ? `Entered plan mode with focus: ${state.planFocus}`
        : 'Entered plan mode',
    )
    return
  }

  if (action === 'exit' || action === 'off') {
    if (state.executionMode !== 'plan') {
      info('Plan mode is not active')
      return
    }
    state.executionMode = 'default'
    state.planFocus = undefined
    state.sessionTouched = true
    await saveCurrentSession(state)
    ok('Exited plan mode')
    return
  }

  fail('Usage: /plan-mode [enter [focus]|exit|status]')
}

async function handleWorktreeModeCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action || action === 'status') {
    if (state.executionMode !== 'worktree') {
      info('Worktree mode is not active')
      return
    }
    info(`Active worktree: ${state.activeWorktreePath || state.settings.workspaceRoot}`)
    if (state.worktreeBaseRoot) {
      info(`Base workspace: ${state.worktreeBaseRoot}`)
    }
    return
  }

  if (action === 'enter' || action === 'switch') {
    if (state.executionMode === 'plan') {
      warn('Exit plan mode before entering worktree mode.')
      return
    }
    const reference = stripWrappingQuotes(rest).trim()
    if (!reference) {
      fail('Usage: /worktree-mode enter <name|path>')
      return
    }
    const baseRoot =
      state.executionMode === 'worktree'
        ? state.worktreeBaseRoot || state.settings.workspaceRoot
        : state.settings.workspaceRoot
    const worktree = await findGitWorktree(baseRoot, reference)
    if (!worktree) {
      fail(`Worktree not found: ${reference}`)
      return
    }
    state.executionMode = 'worktree'
    state.worktreeBaseRoot = baseRoot
    state.activeWorktreePath = worktree.path
    await handleWorkspaceCommand(state, worktree.path)
    state.sessionTouched = true
    await saveCurrentSession(state)
    ok(`Entered worktree mode in ${worktree.path}`)
    return
  }

  if (action === 'exit' || action === 'off') {
    if (state.executionMode !== 'worktree') {
      info('Worktree mode is not active')
      return
    }
    const restoreRoot = state.worktreeBaseRoot || state.settings.workspaceRoot
    state.executionMode = 'default'
    state.activeWorktreePath = undefined
    state.worktreeBaseRoot = undefined
    state.sessionTouched = true
    if (path.resolve(state.settings.workspaceRoot) !== path.resolve(restoreRoot)) {
      await handleWorkspaceCommand(state, restoreRoot)
    }
    await saveCurrentSession(state)
    ok(`Exited worktree mode${restoreRoot ? ` and restored ${restoreRoot}` : ''}`)
    return
  }

  fail('Usage: /worktree-mode [enter <ref>|exit|status]')
}

async function handleWorktreeCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'list') {
    const worktrees = await listGitWorktrees(state.settings.workspaceRoot)
    printWorktreeList(worktrees, state.settings.workspaceRoot)
    return
  }

  if (action === 'add') {
    const tokens = tokenizeQuotedArgs(rest)
    const targetPath = tokens.shift()
    if (!targetPath) {
      fail('Usage: /worktree add <path> [branch] [base]')
      return
    }
    const branch = tokens.shift()
    const base = tokens.shift()
    const worktree = await addGitWorktree({
      workspaceRoot: state.settings.workspaceRoot,
      targetPath,
      branch,
      createBranch: Boolean(branch),
      base,
    })
    ok(`Created worktree at ${worktree.path}`)
    return
  }

  if (action === 'show' || action === 'inspect' || action === 'status') {
    const reference = stripWrappingQuotes(rest).trim()
    if (!reference) {
      fail('Usage: /worktree show <name|path>')
      return
    }
    const details = await inspectGitWorktree(state.settings.workspaceRoot, reference)
    if (!details) {
      fail(`Worktree not found: ${reference}`)
      return
    }
    printWorktreeDetails(details)
    return
  }

  if (action === 'switch') {
    const reference = stripWrappingQuotes(rest).trim()
    if (!reference) {
      fail('Usage: /worktree switch <name|path>')
      return
    }
    const worktree = await findGitWorktree(state.settings.workspaceRoot, reference)
    if (!worktree) {
      fail(`Worktree not found: ${reference}`)
      return
    }
    await handleWorkspaceCommand(state, worktree.path)
    ok(`Switched to worktree ${worktree.path}`)
    return
  }

  if (action === 'remove') {
    const tokens = tokenizeQuotedArgs(rest)
    const targetPath = tokens.shift()
    if (!targetPath) {
      fail('Usage: /worktree remove <path> [--force]')
      return
    }
    await removeGitWorktree(
      state.settings.workspaceRoot,
      targetPath,
      tokens.includes('--force'),
    )
    ok(`Removed worktree ${targetPath}`)
    return
  }

  if (action === 'prune') {
    await pruneGitWorktrees(state.settings.workspaceRoot)
    ok('Pruned stale git worktrees')
    return
  }

  fail('Usage: /worktree [list|show <ref>|switch <ref>|add <path> [branch] [base]|remove <path> [--force]|prune]')
}

async function handleTeleportCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'path') {
    const targetPath = stripWrappingQuotes(action === 'path' ? rest : rawArgs).trim()
    if (!targetPath) {
      fail('Usage: /teleport path <workspace-root> | /teleport worktree <name|path>')
      return
    }
    await handleWorkspaceCommand(state, targetPath)
    return
  }

  if (action === 'worktree') {
    const reference = stripWrappingQuotes(rest).trim()
    if (!reference) {
      fail('Usage: /teleport worktree <name|path>')
      return
    }
    const worktree = await findGitWorktree(state.settings.workspaceRoot, reference)
    if (!worktree) {
      fail(`Worktree not found: ${reference}`)
      return
    }
    await handleWorkspaceCommand(state, worktree.path)
    ok(`Teleported to worktree ${worktree.path}`)
    return
  }

  fail('Usage: /teleport path <workspace-root> | /teleport worktree <name|path>')
}

async function handleNotebookCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    info('Usage: /notebook cells|read|set|add|delete ...')
    return
  }

  const tokens = tokenizeQuotedArgs(rest)
  const notebookPath = tokens.shift()
  if (!notebookPath) {
    fail('Notebook path is required')
    return
  }

  if (action === 'cells' || action === 'list') {
    const cells = await listNotebookCells(
      state.settings.workspaceRoot,
      notebookPath,
      state.settings.accessMode,
    )
    if (!cells.length) {
      info('Notebook has no cells')
      return
    }
    for (const cell of cells) {
      process.stdout.write(
        `- [${cell.index}] ${cell.type}${cell.id ? ` ${dim(`#${cell.id}`)}` : ''} ${dim(`${cell.lines} line(s)`)} ${cell.preview}\n`,
      )
    }
    return
  }

  if (action === 'read' || action === 'show') {
    const reference = tokens.shift()
    if (!reference) {
      fail('Usage: /notebook read <path> <index|id>')
      return
    }
    const cell = await readNotebookCell(
      state.settings.workspaceRoot,
      notebookPath,
      reference,
      state.settings.accessMode,
    )
    printDivider()
    process.stdout.write(`${label(`Notebook Cell ${cell.index}`)} ${dim(`[${cell.type}]`)}\n`)
    if (cell.id) {
      process.stdout.write(`${dim(`#${cell.id}`)}\n`)
    }
    process.stdout.write(`${cell.source}\n`)
    printDivider()
    return
  }

  if (action === 'set') {
    const reference = tokens.shift()
    if (!reference || !tokens.length) {
      fail('Usage: /notebook set <path> <index|id> <content>')
      return
    }
    const result = await setNotebookCellSource({
      workspaceRoot: state.settings.workspaceRoot,
      notebookPath,
      reference,
      newSource: tokens.join(' '),
      accessMode: state.settings.accessMode,
      safeWriteMode: state.settings.safeWriteMode,
      source: 'manual',
    })
    ok(`Notebook cell ${result.index} ${result.mode === 'staged' ? 'staged' : 'updated'}`)
    return
  }

  if (action === 'add') {
    const type = (tokens.shift() || '').toLowerCase() as 'code' | 'markdown' | 'raw'
    if (!['code', 'markdown', 'raw'].includes(type) || !tokens.length) {
      fail('Usage: /notebook add <path> <code|markdown|raw> <content>')
      return
    }
    const result = await addNotebookCell({
      workspaceRoot: state.settings.workspaceRoot,
      notebookPath,
      type,
      content: tokens.join(' '),
      accessMode: state.settings.accessMode,
      safeWriteMode: state.settings.safeWriteMode,
      source: 'manual',
    })
    ok(`Notebook cell inserted at ${result.index} (${result.mode})`)
    return
  }

  if (action === 'delete' || action === 'remove') {
    const reference = tokens.shift()
    if (!reference) {
      fail('Usage: /notebook delete <path> <index|id>')
      return
    }
    const result = await deleteNotebookCell({
      workspaceRoot: state.settings.workspaceRoot,
      notebookPath,
      reference,
      accessMode: state.settings.accessMode,
      safeWriteMode: state.settings.safeWriteMode,
      source: 'manual',
    })
    ok(`Notebook cell ${result.index} removed (${result.mode})`)
    return
  }

  fail('Usage: /notebook cells|read|set|add|delete ...')
}

async function handleTeamsCommand(): Promise<void> {
  const teams = await listTeams()
  if (!teams.length) {
    info('No teams configured')
    return
  }
  for (const team of teams) {
    process.stdout.write(
      `- ${team.name} ${dim(`${team.members.length} member(s)`)}` +
        `${team.description ? ` ${dim(team.description)}` : ''}\n`,
    )
  }
}

async function buildTeamMemberPrompt(
  teamName: string,
  member: {
    name: string
    rolePrompt?: string
  },
  taskPrompt: string,
): Promise<string> {
  const [teamMemory, teamMessages] = await Promise.all([
    getTeamMemory(teamName),
    listTeamMessages(teamName, member.name),
  ])

  return [
    member.rolePrompt ? `Role: ${member.rolePrompt}` : '',
    `Team member: ${member.name}`,
    teamMemory?.content ? `Team memory:\n${teamMemory.content}` : '',
    teamMessages.length
      ? `Team inbox:\n${teamMessages
          .slice(-8)
          .map(message => `- [${message.createdAt}] ${message.from} -> ${message.to}: ${message.content}`)
          .join('\n')}`
      : '',
    taskPrompt,
  ]
    .filter(Boolean)
    .join('\n\n')
}

async function handleTeamCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    await handleTeamsCommand()
    return
  }

  if (action === 'create') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    if (!name) {
      fail('Usage: /team create <name> [member,member,...]')
      return
    }
    const members = (tokens.shift() || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(item => ({ name: item, agentName: item }))
    const team = await createTeam({ name, members })
    ok(`Created team ${team.name}`)
    return
  }

  if (action === 'show') {
    const team = await getTeam(rest)
    if (!team) {
      fail(`Team not found: ${rest}`)
      return
    }
    const [memory, messages] = await Promise.all([
      getTeamMemory(team.name),
      listTeamMessages(team.name),
    ])
    printKeyValueBlock(`Team ${team.name}`, [
      { label: 'description', value: team.description || '(none)' },
      { label: 'members', value: String(team.members.length) },
      { label: 'memory', value: memory?.updatedAt || '(empty)' },
      { label: 'messages', value: String(messages.length) },
    ])
    for (const member of team.members) {
      process.stdout.write(
        `- ${member.name}${member.agentName ? ` ${dim(`[agent=${member.agentName}]`)}` : ''}` +
          `${member.rolePrompt ? ` ${dim(member.rolePrompt)}` : ''}\n`,
      )
    }
    return
  }

  if (action === 'add-member') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    const memberName = tokens.shift()
    if (!teamName || !memberName) {
      fail('Usage: /team add-member <team> <member> [agentName] [rolePrompt]')
      return
    }
    await addTeamMember(teamName, {
      name: memberName,
      agentName: tokens.shift(),
      rolePrompt: tokens.join(' ') || undefined,
    })
    ok(`Added ${memberName} to ${teamName}`)
    return
  }

  if (action === 'remove-member') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    const memberName = tokens.shift()
    if (!teamName || !memberName) {
      fail('Usage: /team remove-member <team> <member>')
      return
    }
    await removeTeamMember(teamName, memberName)
    ok(`Removed ${memberName} from ${teamName}`)
    return
  }

  if (action === 'delete' || action === 'remove') {
    const reference = rest.trim()
    if (!reference) {
      fail('Usage: /team delete <name>')
      return
    }
    await removeTeam(reference)
    ok(`Removed team ${reference}`)
    return
  }

  if (action === 'message') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    const from = tokens.shift()
    const to = tokens.shift()
    const content = tokens.join(' ').trim()
    if (!teamName || !from || !to || !content) {
      fail('Usage: /team message <team> <from> <to|all> <text>')
      return
    }
    const message = await sendTeamMessage({
      team: teamName,
      from,
      to,
      content,
    })
    ok(`Queued team message ${message.id}`)
    return
  }

  if (action === 'inbox' || action === 'messages') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    if (!teamName) {
      fail('Usage: /team inbox <team> [member]')
      return
    }
    const messages = await listTeamMessages(teamName, tokens.shift())
    printTeamMessages(messages)
    return
  }

  if (action === 'clear-inbox') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    if (!teamName) {
      fail('Usage: /team clear-inbox <team> [member]')
      return
    }
    const removed = await clearTeamMessages(teamName, tokens.shift())
    ok(`Cleared ${removed} team message(s)`)
    return
  }

  if (action === 'memory') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    const subaction = (tokens.shift() || 'show').toLowerCase()
    if (!teamName) {
      fail('Usage: /team memory <team> [show|set|append|sync|scan] [text]')
      return
    }
    const forceIndex = tokens.findIndex(token => token === '--force')
    const force = forceIndex >= 0
    if (forceIndex >= 0) {
      tokens.splice(forceIndex, 1)
    }
    if (subaction === 'show') {
      const memory = await getTeamMemory(teamName)
      printDivider()
      process.stdout.write(`${label(`Team Memory ${teamName}`)}\n\n${memory?.content || dim('(empty)')}\n`)
      printDivider()
      return
    }
    if (subaction === 'scan') {
      const result = await scanTeamMemory(teamName)
      if (!result.matches.length) {
        ok(`No high-confidence secrets detected in team memory for ${result.teamName}`)
        return
      }
      warn(`Detected likely secrets in team memory for ${result.teamName}: ${result.matches.map(match => match.label).join(', ')}`)
      return
    }
    if (subaction === 'set') {
      const memory = await setTeamMemory(teamName, tokens.join(' '), { force })
      ok(`Updated team memory for ${memory.teamName}`)
      return
    }
    if (subaction === 'append') {
      const memory = await appendTeamMemory(teamName, tokens.join(' '), { force })
      ok(`Appended team memory for ${memory.teamName}`)
      return
    }
    if (subaction === 'sync') {
      const memory = await syncTeamMemoryFromMessages(teamName, { force })
      ok(`Synced team memory for ${memory.teamName}`)
      return
    }
    fail('Usage: /team memory <team> [show|set|append|sync|scan] [text] [--force]')
    return
  }

  if (action === 'run') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    if (!teamName || !tokens.length) {
      fail('Usage: /team run <team> <prompt>')
      return
    }
    const team = await getTeam(teamName)
    if (!team) {
      fail(`Team not found: ${teamName}`)
      return
    }
    const taskPrompt = tokens.join(' ')
    printDivider()
    process.stdout.write(`${label(`Team ${team.name}`)}\n`)
    for (const member of team.members) {
      process.stdout.write(`${dim(`Running ${member.name}...`)}\n`)
      const agent = member.agentName
        ? await getLocalAgent(member.agentName, state.settings.workspaceRoot, state.cwd)
        : null
      const answer = await runPromptInternal(
        state,
        await buildTeamMemberPrompt(team.name, member, taskPrompt),
        agent
          ? {
              ...(await buildAgentPromptRunOptions(state, agent, [`Team member: ${member.name}`])),
              source: 'team',
            }
          : { isolated: true, source: 'team' },
      )
      process.stdout.write(`${magenta(member.name)}\n${answer || ''}\n`)
    }
    printDivider()
    return
  }

  if (action === 'task') {
    const tokens = tokenizeQuotedArgs(rest)
    const teamName = tokens.shift()
    if (!teamName || !tokens.length) {
      fail('Usage: /team task <team> <prompt>')
      return
    }
    const team = await getTeam(teamName)
    if (!team) {
      fail(`Team not found: ${teamName}`)
      return
    }
    const taskPrompt = tokens.join(' ')
    const createdTasks = []
    for (const member of team.members) {
      const agent = member.agentName
        ? await getLocalAgent(member.agentName, state.settings.workspaceRoot, state.cwd)
        : null
      const rolePrompt = await buildTeamMemberPrompt(team.name, member, taskPrompt)
      const task = await createTask({
        title: `${team.name}:${member.name}`,
        prompt: rolePrompt,
        workspaceRoot: state.settings.workspaceRoot,
        accessMode: state.settings.accessMode,
        safeWriteMode: state.settings.safeWriteMode,
        providerId: getSelectedProvider(state.settings).id,
        model: agent?.model || resolveModel(state.settings, getSelectedProvider(state.settings)),
        cwd: state.cwd,
        baseMessages: [],
      })
      await recordTaskRunnerPid(task.id, launchTaskRunner(task.id))
      createdTasks.push({ member: member.name, id: task.id, logPath: task.logPath })
    }
    process.stdout.write(`${JSON.stringify({ team: team.name, tasks: createdTasks }, null, 2)}\n`)
    return
  }

  fail('Usage: /team create|show|add-member|remove-member|message|inbox|clear-inbox|memory|run|task|delete ...')
}

async function handleBridgesCommand(): Promise<void> {
  const bridges = await listBridges()
  if (!bridges.length) {
    info('No bridge endpoints configured')
    return
  }
  for (const bridge of bridges) {
    process.stdout.write(
      `- ${bridge.name} ${dim(bridge.baseUrl)} ${bridge.enabled ? green('enabled') : red('disabled')}\n`,
    )
  }
}

async function handleBridgeCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    await handleBridgesCommand()
    return
  }

  if (action === 'add') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    const url = tokens.shift()
    if (!name || !url) {
      fail('Usage: /bridge add <name> <url> [token]')
      return
    }
    const bridge = await addBridge({
      name,
      baseUrl: url,
      token: tokens.shift(),
    })
    ok(`Saved bridge ${bridge.name}`)
    return
  }

  if (action === 'enable' || action === 'disable') {
    const name = rest.trim()
    if (!name) {
      fail(`Usage: /bridge ${action} <name>`)
      return
    }
    const bridge = await setBridgeEnabled(name, action === 'enable')
    ok(`${bridge.name} ${action}d`)
    return
  }

  if (action === 'remove') {
    const name = rest.trim()
    if (!name) {
      fail('Usage: /bridge remove <name>')
      return
    }
    await removeBridge(name)
    ok(`Removed bridge ${name}`)
    return
  }

  if (action === 'ping') {
    const name = rest.trim()
    if (!name) {
      fail('Usage: /bridge ping <name>')
      return
    }
    const result = await pingBridge(name)
    process.stdout.write(`${result.status} ${result.ok ? green('OK') : red('FAIL')} ${truncate(result.body, 180)}\n`)
    return
  }

  if (action === 'context') {
    const name = rest.trim()
    if (!name) {
      fail('Usage: /bridge context <name>')
      return
    }
    const result = await fetchBridgeContext(name)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }

  if (action === 'run') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    if (!name || !tokens.length) {
      fail('Usage: /bridge run <name> <command>')
      return
    }
    const result = await runBridgeCommand({
      reference: name,
      command: tokens.join(' '),
      cwd: state.cwd,
      timeoutMs: state.settings.commandTimeoutMs,
    })
    process.stdout.write(`${JSON.stringify(result.payload, null, 2)}\n`)
    return
  }

  fail('Usage: /bridge add|enable|disable|remove|ping|context|run ...')
}

async function handleMarketplaceCommand(rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'list') {
    const items = await listMarketplaceItems()
    if (!items.length) {
      info('No marketplace items configured')
      return
    }
    for (const item of items) {
      process.stdout.write(
        `- ${item.name} ${dim(`[${item.type}]`)} ${dim(item.source)}` +
          `${item.installedAt ? ` ${green('installed')}` : ''}\n`,
      )
    }
    return
  }

  if (action === 'add') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    const type = (tokens.shift() || 'auto').toLowerCase() as 'auto' | 'plugin' | 'skill'
    const source = tokens.shift()
    if (!name || !source || !['auto', 'plugin', 'skill'].includes(type)) {
      fail('Usage: /marketplace add <name> <auto|plugin|skill> <source> [description]')
      return
    }
    const item = await addMarketplaceItem({
      name,
      type,
      source,
      description: tokens.join(' ') || undefined,
    })
    ok(`Added marketplace item ${item.name}`)
    return
  }

  if (action === 'install') {
    const reference = rest.trim()
    if (!reference) {
      fail('Usage: /marketplace install <name>')
      return
    }
    const result = await installMarketplaceItem(reference)
    ok(`Installed ${result.installedAs} from ${result.item.name}`)
    return
  }

  if (action === 'remove') {
    const reference = rest.trim()
    if (!reference) {
      fail('Usage: /marketplace remove <name>')
      return
    }
    await removeMarketplaceItem(reference)
    ok(`Removed marketplace item ${reference}`)
    return
  }

  fail('Usage: /marketplace [list|add|install|remove] ...')
}

async function handleLspCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (action === 'workspace-symbols' || action === 'workspace' || action === 'ws') {
    const query = stripWrappingQuotes(rest).trim()
    if (!query) {
      fail('Usage: /lsp workspace-symbols <query>')
      return
    }
    const symbols = await getLspWorkspaceSymbols({
      workspaceRoot: state.settings.workspaceRoot,
      query,
      accessMode: state.settings.accessMode,
    })
    process.stdout.write(`${JSON.stringify(symbols, null, 2)}\n`)
    return
  }

  const tokens = tokenizeQuotedArgs(rest)
  const targetPath = tokens.shift()

  if (!action || !targetPath) {
    info('Usage: /lsp diagnostics|defs|impl|refs|rename-preview|rename-apply|hover|symbols <path> [line] [column]')
    return
  }

  if (action === 'diagnostics') {
    const diagnostics = await getLspDiagnostics(
      state.settings.workspaceRoot,
      targetPath,
      state.settings.accessMode,
    )
    process.stdout.write(`${JSON.stringify(diagnostics, null, 2)}\n`)
    return
  }

  if (action === 'symbols') {
    const symbols = await getLspDocumentSymbols(
      state.settings.workspaceRoot,
      targetPath,
      state.settings.accessMode,
    )
    process.stdout.write(`${JSON.stringify(symbols, null, 2)}\n`)
    return
  }

  const position = parseLineColumnArgs(tokens)

  if (action === 'defs' || action === 'definition') {
    const definitions = await getLspDefinitions({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
    })
    process.stdout.write(`${JSON.stringify(definitions, null, 2)}\n`)
    return
  }

  if (action === 'impl' || action === 'implementation') {
    const implementations = await getLspImplementations({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
    })
    process.stdout.write(`${JSON.stringify(implementations, null, 2)}\n`)
    return
  }

  if (action === 'refs' || action === 'references') {
    const references = await getLspReferences({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
    })
    process.stdout.write(`${JSON.stringify(references, null, 2)}\n`)
    return
  }

  if (action === 'rename-preview' || action === 'rename') {
    const newName = tokens[2]
    const preview = await getLspRenamePreview({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
      newName,
    })
    process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`)
    return
  }

  if (action === 'rename-apply' || action === 'rename-write') {
    const newName = stripWrappingQuotes(tokens[2] || '').trim()
    if (!newName) {
      fail('Usage: /lsp rename-apply <path> <line> <column> <newName>')
      return
    }

    const plan = await buildLspRenameEditPlan({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
      newName,
    })
    if (!plan.canRename) {
      throw new Error(plan.localizedErrorMessage ?? 'Rename cannot be applied')
    }

    const results = await applyWorkspaceBatchChanges({
      workspaceRoot: state.settings.workspaceRoot,
      files: plan.files.map(file => ({
        path: file.path,
        content: file.updatedContent,
        source: 'manual',
      })),
      safeWriteMode: state.settings.safeWriteMode,
      accessMode: state.settings.accessMode,
    })

    process.stdout.write(
      `${JSON.stringify(
        {
          canRename: true,
          displayName: plan.displayName,
          fileCount: plan.files.length,
          occurrenceCount: plan.files.reduce((sum, file) => sum + file.occurrences, 0),
          results,
        },
        null,
        2,
      )}\n`,
    )
    return
  }

  if (action === 'hover') {
    const hover = await getLspHover({
      workspaceRoot: state.settings.workspaceRoot,
      filePath: targetPath,
      line: position.line,
      column: position.column,
      accessMode: state.settings.accessMode,
    })
    process.stdout.write(`${JSON.stringify(hover, null, 2)}\n`)
    return
  }

  fail('Usage: /lsp diagnostics|defs|impl|refs|rename-preview|rename-apply|hover|symbols <path> [line] [column] | /lsp workspace-symbols <query>')
}

function printSessions(sessions: CliSessionRecord[], currentSessionId?: string): void {
  if (!sessions.length) {
    info('No saved CLI sessions')
    return
  }

  for (const session of sessions.slice(0, 30)) {
    const marker = session.id === currentSessionId ? green('*') : dim('-')
    process.stdout.write(
      `${marker} ${session.id} ${dim(session.updatedAt)} ${dim(`[${session.workspaceRoot}]`)} ${truncate(session.title, 80)}\n`,
    )
  }

  if (sessions.length > 30) {
    info(`...and ${sessions.length - 30} more sessions`)
  }
}

async function handleSessionsCommand(state: CliState): Promise<void> {
  const sessions = await listCliSessions()
  printSessions(sessions, state.sessionId)
}

async function handleResumeCommand(state: CliState, rawArgs: string): Promise<void> {
  const reference = rawArgs.trim() || 'latest'
  const session = await loadSessionIntoState(state, reference)
  if (!session) {
    fail(`Session not found: ${reference}`)
    return
  }
  ok(`Resumed ${session.id} - ${session.title}`)
}

async function handleTitleCommand(state: CliState, rawArgs: string): Promise<void> {
  const nextTitle = rawArgs.trim()
  if (!nextTitle) {
    fail('Usage: /title <text>')
    return
  }

  state.sessionTitle = truncate(nextTitle, MAX_MESSAGE_TITLE_LENGTH)
  state.explicitTitle = true
  state.sessionTouched = true
  await saveCurrentSession(state)
  ok(`Session title set to "${state.sessionTitle}"`)
}

async function handleDeleteSessionCommand(state: CliState, rawArgs: string): Promise<void> {
  const reference = rawArgs.trim()
  if (!reference) {
    fail('Usage: /delete-session <id|latest|current>')
    return
  }

  const target =
    reference.toLowerCase() === 'current'
      ? { id: state.sessionId, title: state.sessionTitle }
      : await findSessionRecord(reference)

  if (!target) {
    fail(`Session not found: ${reference}`)
    return
  }

  await deleteCliSession(target.id)
  await clearSessionTodos(target.id)
  ok(`Deleted session ${target.id}`)

  if (target.id === state.sessionId) {
    startFreshSession(state)
    info('Current session was deleted, so a fresh session was created')
  }
}

async function buildConversationCompactSummary(
  state: CliState,
  instructions: string,
): Promise<string | null> {
  if (!state.messages.length && !state.compactSummaries.length) {
    return null
  }

  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const skillSystemMessage = await buildActiveSkillSystemMessage(state.activeSkills, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
  })
  const compactSystemMessage = buildCompactSystemMessage(state)
  const summaryPrompt = [
    'Compact the current RoyCode conversation into one durable summary.',
    'Preserve only information that should matter in later turns:',
    '- user goals and constraints',
    '- important architectural findings',
    '- files, commands, and decisions that still matter',
    '- unfinished work, risks, and verification status',
    'Omit chatter and temporary back-and-forth.',
    instructions ? `Extra instructions:\n${instructions}` : '',
    'Return plain markdown only.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await streamAgentChat(
    provider,
    state.settings,
    {
      providerId: provider.id,
      model,
      cwd: state.cwd,
      maxAgentSteps: 1,
      systemAddenda: [
        'You are summarizing a coding-agent transcript for future continuation. Do not call tools.',
        ...(compactSystemMessage ? [compactSystemMessage] : []),
        ...(skillSystemMessage ? [skillSystemMessage] : []),
      ],
      messages: [
        ...cloneMessages(state.messages),
        {
          role: 'user',
          content: summaryPrompt,
        },
      ],
    },
    {
      async onEvent(event) {
        if (event.type === 'status') {
          process.stdout.write(`${dim(`[compact] ${event.message}`)}\n`)
        }
      },
    },
  )

  return response.answer.trim() || null
}

async function buildConversationSummary(
  state: CliState,
  instructions: string,
): Promise<string | null> {
  if (!state.messages.length && !state.compactSummaries.length) {
    return null
  }

  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const skillSystemMessage = await buildActiveSkillSystemMessage(state.activeSkills, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
  })
  const compactSystemMessage = buildCompactSystemMessage(state)
  const summaryPrompt = [
    'Summarize the current RoyCode session for a developer who needs the current state quickly.',
    'Structure the answer with these sections when relevant:',
    '- Goal',
    '- Important Findings',
    '- Files and Commands',
    '- Open Work',
    '- Risks or Verification Gaps',
    'Keep it concise, high-signal, and focused on what still matters now.',
    instructions ? `Extra instructions:\n${instructions}` : '',
    'Return plain markdown only.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await streamAgentChat(
    provider,
    state.settings,
    {
      providerId: provider.id,
      model,
      cwd: state.cwd,
      maxAgentSteps: 1,
      systemAddenda: [
        'You are summarizing a coding-agent session. Do not call tools.',
        ...(compactSystemMessage ? [compactSystemMessage] : []),
        ...(skillSystemMessage ? [skillSystemMessage] : []),
      ],
      messages: [
        ...cloneMessages(state.messages),
        {
          role: 'user',
          content: summaryPrompt,
        },
      ],
    },
    {
      async onEvent(event) {
        if (event.type === 'status') {
          process.stdout.write(`${dim(`[summary] ${event.message}`)}\n`)
        }
      },
    },
  )

  return response.answer.trim() || null
}

async function buildWorkspaceMemoryExtraction(
  state: CliState,
  instructions: string,
): Promise<string | null> {
  if (!state.messages.length && !state.compactSummaries.length) {
    return null
  }

  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const compactSystemMessage = buildCompactSystemMessage(state)
  const currentMemory = await readWorkspaceMemory(state.settings.workspaceRoot)
  const prompt = [
    'Extract only durable project memory from this RoyCode session.',
    'Keep only information that should still matter later in this workspace:',
    '- coding conventions',
    '- architecture decisions',
    '- important commands or setup notes',
    '- stable constraints or known pitfalls',
    'Do not include temporary chatter or one-off steps.',
    'Return short markdown bullets only.',
    instructions ? `Extra instructions:\n${instructions}` : '',
    currentMemory.content.trim()
      ? `Current workspace memory:\n${currentMemory.content}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const response = await streamAgentChat(
    provider,
    state.settings,
    {
      providerId: provider.id,
      model,
      cwd: state.cwd,
      maxAgentSteps: 1,
      systemAddenda: [
        'You are extracting durable workspace memory. Do not call tools.',
        ...(compactSystemMessage ? [compactSystemMessage] : []),
      ],
      messages: [
        ...cloneMessages(state.messages),
        {
          role: 'user',
          content: prompt,
        },
      ],
    },
    {
      async onEvent(event) {
        if (event.type === 'status') {
          process.stdout.write(`${dim(`[memory] ${event.message}`)}\n`)
        }
      },
    },
  )

  return response.answer.trim() || null
}

function rankCounts(
  counts: Map<string, number>,
  limit = 5,
): Array<{ value: string; count: number }> {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }))
}

async function buildThinkbackSummary(state: CliState): Promise<ThinkbackSummary> {
  await saveCurrentSession(state)
  const sessions = await listCliSessions()
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000
  const workspaceCounts = new Map<string, number>()
  const modelCounts = new Map<string, number>()
  const providerCounts = new Map<string, number>()
  const modeCounts = new Map<string, number>()

  let activeSessionsLast30Days = 0
  let totalMessages = 0
  let totalCompactions = 0

  for (const session of sessions) {
    const updatedMs = Date.parse(session.updatedAt)
    if (Number.isFinite(updatedMs) && updatedMs >= cutoffMs) {
      activeSessionsLast30Days += 1
    }
    totalMessages += session.messages.length
    totalCompactions += session.compactSummaries?.length ?? 0
    workspaceCounts.set(
      session.workspaceRoot,
      (workspaceCounts.get(session.workspaceRoot) ?? 0) + 1,
    )
    if (session.model) {
      modelCounts.set(session.model, (modelCounts.get(session.model) ?? 0) + 1)
    }
    if (session.providerId) {
      providerCounts.set(
        session.providerId,
        (providerCounts.get(session.providerId) ?? 0) + 1,
      )
    }
    modeCounts.set(
      session.executionMode ?? 'default',
      (modeCounts.get(session.executionMode ?? 'default') ?? 0) + 1,
    )
  }

  return {
    totalSessions: sessions.length,
    activeSessionsLast30Days,
    totalMessages,
    totalCompactions,
    topWorkspaces: rankCounts(workspaceCounts).map(item => ({
      workspaceRoot: item.value,
      count: item.count,
    })),
    topModels: rankCounts(modelCounts).map(item => ({
      model: item.value,
      count: item.count,
    })),
    topProviders: rankCounts(providerCounts).map(item => ({
      providerId: item.value,
      count: item.count,
    })),
    topModes: rankCounts(modeCounts).map(item => ({
      mode: item.value,
      count: item.count,
    })),
    recentTitles: sessions
      .map(session => session.title.trim())
      .filter(Boolean)
      .slice(0, 8),
  }
}

function printThinkbackSummary(summary: ThinkbackSummary): void {
  printDivider()
  process.stdout.write(`${label('RoyCode Thinkback')}\n`)
  process.stdout.write(
    [
      `${label('sessions')} ${summary.totalSessions}`,
      `${label('last-30d')} ${summary.activeSessionsLast30Days}`,
      `${label('messages')} ${summary.totalMessages}`,
      `${label('compactions')} ${summary.totalCompactions}`,
    ].join(` ${dim('|')} `) + '\n\n',
  )

  printKeyValueBlock(
    'Top Workspaces',
    summary.topWorkspaces.length
      ? summary.topWorkspaces.map(item => ({
          label: item.workspaceRoot,
          value: String(item.count),
        }))
      : [{ label: '(none)', value: '0' }],
  )
  process.stdout.write('\n')

  printKeyValueBlock(
    'Top Providers',
    summary.topProviders.length
      ? summary.topProviders.map(item => ({
          label: item.providerId,
          value: String(item.count),
        }))
      : [{ label: '(none)', value: '0' }],
  )
  process.stdout.write('\n')

  printKeyValueBlock(
    'Top Models',
    summary.topModels.length
      ? summary.topModels.map(item => ({
          label: item.model,
          value: String(item.count),
        }))
      : [{ label: '(none)', value: '0' }],
  )
  process.stdout.write('\n')

  printKeyValueBlock(
    'Execution Modes',
    summary.topModes.length
      ? summary.topModes.map(item => ({
          label: item.mode,
          value: String(item.count),
        }))
      : [{ label: '(none)', value: '0' }],
  )
  process.stdout.write('\n')

  printKeyValueBlock(
    'Recent Session Titles',
    summary.recentTitles.length
      ? summary.recentTitles.map(title => ({
          label: title,
          value: '',
        }))
      : [{ label: '(none)', value: '' }],
  )
  printDivider()
}

function parseUsageWindowDays(rawArgs: string): number {
  const normalized = rawArgs.trim().toLowerCase()
  if (!normalized) {
    return 7
  }
  if (normalized === 'today' || normalized === '1d') {
    return 1
  }
  if (normalized === '7d' || normalized === 'week' || normalized === 'weekly') {
    return 7
  }
  if (normalized === '30d' || normalized === 'month' || normalized === 'monthly') {
    return 30
  }
  const numeric = Number.parseInt(normalized, 10)
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.min(365, numeric)
  }
  throw new Error('Usage window must be today, 7d, 30d, or a positive number of days')
}

function formatDurationMs(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(1)}s`
  }
  return `${(durationMs / 60_000).toFixed(1)}m`
}

function formatUsd(value: number): string {
  return value > 0 ? `$${value.toFixed(4)}` : '$0.0000'
}

function buildSuggestionContext(state: CliState) {
  return {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    executionMode: state.executionMode,
    activeSkills: state.activeSkills,
    briefMode: state.settings.briefMode ?? false,
    pendingAttachments: state.pendingAttachments.length,
    compactSummaries: state.compactSummaries.length,
    messages: state.messages,
  }
}

function printSuggestions(state: CliState): void {
  if (!state.lastSuggestions.length) {
    info('No prompt suggestions are cached yet. Run /suggest first.')
    return
  }
  printDivider()
  process.stdout.write(`${label('Prompt Suggestions')}\n`)
  state.lastSuggestions.forEach((suggestion, index) => {
    process.stdout.write(`${index + 1}. ${suggestion}\n`)
  })
  printDivider()
}

async function printRuntimeStats(state: CliState): Promise<void> {
  const [sessions, tasks, hooks, teams, plugins, mcpServers, skills, commands, usage] =
    await Promise.all([
      listCliSessions(),
      listTasks(),
      listHooks(),
      listTeams(),
      listInstalledPlugins(),
      listMcpServers(state.settings.workspaceRoot),
      listLocalSkills(state.settings.workspaceRoot, state.cwd),
      listLocalCompatCommands(state.settings.workspaceRoot, state.cwd),
      summarizeUsage(30),
    ])

  const sleepGuard = await getSleepGuardStatus()
  printDivider()
  process.stdout.write(`${label('RoyCode Runtime Stats')}\n`)
  process.stdout.write(
    [
      `${label('sessions')} ${sessions.length}`,
      `${label('tasks')} ${tasks.length}`,
      `${label('hooks')} ${hooks.length}`,
      `${label('teams')} ${teams.length}`,
      `${label('plugins')} ${plugins.length}`,
      `${label('mcp')} ${mcpServers.length}`,
      `${label('skills')} ${skills.length}`,
      `${label('commands')} ${commands.length}`,
    ].join(` ${dim('|')} `) + '\n\n',
  )
  printKeyValueBlock('Current Runtime', [
    { label: 'workspace', value: state.settings.workspaceRoot },
    { label: 'cwd', value: state.cwd },
    { label: 'mode', value: describeExecutionMode(state) },
    { label: 'effort', value: resolveEffortLevel(state.settings) },
    { label: 'sleep-guard', value: sleepGuard.enabled ? 'on' : 'off' },
    {
      label: 'notifications',
      value: state.settings.notificationsEnabled ? 'on' : 'off',
    },
    {
      label: 'suggestions',
      value: state.settings.promptSuggestionEnabled === false ? 'off' : 'on',
    },
  ])
  process.stdout.write('\n')
  printKeyValueBlock('Usage (30d)', [
    { label: 'runs', value: String(usage.totalRuns) },
    { label: 'success', value: String(usage.successfulRuns) },
    { label: 'failed', value: String(usage.failedRuns) },
    { label: 'tool-calls', value: String(usage.totalToolCalls) },
    {
      label: 'estimated-tokens',
      value: `${usage.totalInputTokens} in / ${usage.totalOutputTokens} out`,
    },
    { label: 'estimated-cost', value: formatUsd(usage.totalEstimatedCostUsd) },
  ])
  if (usage.byTool.length) {
    process.stdout.write('\n')
    printKeyValueBlock(
      'Top Tools',
      usage.byTool.slice(0, 8).map(item => ({
        label: item.toolName,
        value: String(item.calls),
      })),
    )
  }
  printDivider()
}

async function printUsageSummary(windowDays: number): Promise<void> {
  const summary = await summarizeUsage(windowDays)
  printDivider()
  process.stdout.write(`${label(`RoyCode Usage (${windowDays}d)`)}\n\n`)
  printKeyValueBlock('Totals', [
    { label: 'runs', value: String(summary.totalRuns) },
    { label: 'success', value: String(summary.successfulRuns) },
    { label: 'failed', value: String(summary.failedRuns) },
    { label: 'duration', value: formatDurationMs(summary.totalDurationMs) },
    { label: 'tool-calls', value: String(summary.totalToolCalls) },
    {
      label: 'estimated tokens',
      value: `${summary.totalInputTokens} in / ${summary.totalOutputTokens} out`,
    },
  ])
  process.stdout.write('\n')
  printKeyValueBlock(
    'By Source',
    summary.bySource.length
      ? summary.bySource.map(item => ({
          label: item.source,
          value: String(item.runs),
        }))
      : [{ label: '(none)', value: '0' }],
  )
  process.stdout.write('\n')
  printKeyValueBlock(
    'Top Models',
    summary.byModel.length
      ? summary.byModel.slice(0, 8).map(item => ({
          label: item.model,
          value: `${item.runs} runs / ${formatUsd(item.estimatedCostUsd)}`,
        }))
      : [{ label: '(none)', value: '0' }],
  )
  if (summary.byTool.length) {
    process.stdout.write('\n')
    printKeyValueBlock(
      'Top Tools',
      summary.byTool.slice(0, 10).map(item => ({
        label: item.toolName,
        value: String(item.calls),
      })),
    )
  }
  process.stdout.write('\n')
  printKeyValueBlock(
    'Recent Events',
    summary.recentEvents.length
      ? summary.recentEvents.map(event => ({
          label: `${event.source} ${event.model}`,
          value: `${event.success ? 'ok' : 'fail'} / ${formatDurationMs(event.durationMs)}`,
        }))
      : [{ label: '(none)', value: '' }],
  )
  printDivider()
}

async function printCostSummary(windowDays: number): Promise<void> {
  const summary = await summarizeUsage(windowDays)
  printDivider()
  process.stdout.write(`${label(`RoyCode Cost (${windowDays}d)`)}\n\n`)
  printKeyValueBlock('Estimated Cost', [
    { label: 'input tokens', value: String(summary.totalInputTokens) },
    { label: 'output tokens', value: String(summary.totalOutputTokens) },
    { label: 'estimated usd', value: formatUsd(summary.totalEstimatedCostUsd) },
  ])
  process.stdout.write('\n')
  printKeyValueBlock(
    'By Model',
    summary.byModel.length
      ? summary.byModel.map(item => ({
          label: item.model,
          value: formatUsd(item.estimatedCostUsd),
        }))
      : [{ label: '(none)', value: '$0.0000' }],
  )
  printDivider()
}

type RoyCodePackageMeta = {
  name: string
  version: string
  description?: string
  productName?: string
}

async function readRoyCodePackageMeta(): Promise<RoyCodePackageMeta> {
  const raw = await readFile(PACKAGE_JSON_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<RoyCodePackageMeta>
  return {
    name: parsed.name ?? 'roycode-studio',
    version: parsed.version ?? '0.0.0',
    description: parsed.description,
    productName: parsed.productName,
  }
}

async function collectRoyCodeGitMetadata(
  shell: AppSettings['defaultShell'],
): Promise<{
  isRepo: boolean
  branch?: string
  ahead?: number
  behind?: number
  dirty?: boolean
  head?: string
}> {
  const status = await getGitStatus(APP_ROOT).catch(() => null)
  if (!status?.isRepo) {
    return { isRepo: false }
  }
  const head = await runWorkspaceCommand(
    APP_ROOT,
    'git rev-parse --short HEAD',
    '.',
    10_000,
    'unrestricted',
    undefined,
    shell,
  )
    .then(output => output.trim())
    .catch(() => '')
  return {
    isRepo: true,
    branch: status.branch,
    ahead: status.ahead,
    behind: status.behind,
    dirty: status.stagedCount + status.unstagedCount + status.untrackedCount > 0,
    head: head || undefined,
  }
}

async function printVersionInfo(state: CliState): Promise<void> {
  const [pkg, gitMeta] = await Promise.all([
    readRoyCodePackageMeta(),
    collectRoyCodeGitMetadata(state.settings.defaultShell),
  ])
  printDivider()
  process.stdout.write(`${label(pkg.productName ?? 'RoyCode Studio')}\n`)
  printKeyValueBlock('Version', [
    { label: 'package', value: pkg.name },
    { label: 'version', value: pkg.version },
    { label: 'node', value: process.version },
    { label: 'platform', value: `${process.platform}/${process.arch}` },
    { label: 'app-root', value: APP_ROOT },
    { label: 'workspace', value: state.settings.workspaceRoot },
    { label: 'shell', value: state.settings.defaultShell ?? 'powershell' },
    { label: 'effort', value: resolveEffortLevel(state.settings) },
  ])
  if (gitMeta.isRepo) {
    process.stdout.write('\n')
    printKeyValueBlock('Git', [
      { label: 'branch', value: gitMeta.branch ?? '(unknown)' },
      { label: 'commit', value: gitMeta.head ?? '(unknown)' },
      { label: 'ahead', value: String(gitMeta.ahead ?? 0) },
      { label: 'behind', value: String(gitMeta.behind ?? 0) },
      { label: 'dirty', value: gitMeta.dirty ? 'yes' : 'no' },
    ])
  }
  printDivider()
}

async function printLocalReleaseNotes(
  state: CliState,
  count = MAX_RELEASE_NOTES,
): Promise<void> {
  const safeCount = Math.min(Math.max(count, 1), 30)
  const output = await execProcessCapture(
    'git',
    ['log', '--date=short', '--pretty=reference', '-n', String(safeCount)],
    {
      cwd: APP_ROOT,
      timeoutMs: 12_000,
      env: process.env,
    },
  )
  printDivider()
  process.stdout.write(`${label(`RoyCode Release Notes (${safeCount})`)}\n`)
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
  if (!lines.length) {
    process.stdout.write(`${dim('(no local commits found)')}\n`)
  } else {
    for (const line of lines) {
      process.stdout.write(`- ${line}\n`)
    }
  }
  printDivider()
}

async function printUpgradeStatus(state: CliState): Promise<void> {
  const gitMeta = await collectRoyCodeGitMetadata(state.settings.defaultShell)
  printDivider()
  process.stdout.write(`${label('RoyCode Upgrade Status')}\n`)
  if (!gitMeta.isRepo) {
    process.stdout.write(`${dim('This RoyCode checkout is not inside a git repository.')}\n`)
    printDivider()
    return
  }
  printKeyValueBlock('Repo', [
    { label: 'branch', value: gitMeta.branch ?? '(unknown)' },
    { label: 'commit', value: gitMeta.head ?? '(unknown)' },
    { label: 'ahead', value: String(gitMeta.ahead ?? 0) },
    { label: 'behind', value: String(gitMeta.behind ?? 0) },
    { label: 'dirty', value: gitMeta.dirty ? 'yes' : 'no' },
  ])
  process.stdout.write('\n')
  process.stdout.write(
    `${dim('Run /upgrade run to execute: git pull --ff-only, npm install, npm run install:command')}\n`,
  )
  printDivider()
}

async function runRoyCodeUpgrade(state: CliState): Promise<void> {
  const steps = [
    'git pull --ff-only',
    'npm install',
    'npm run install:command',
  ]
  printDivider()
  process.stdout.write(`${label('RoyCode Upgrade')}\n`)
  for (const step of steps) {
    info(`Running ${step}`)
    const output = await runWorkspaceCommand(
      APP_ROOT,
      step,
      '.',
      step === 'npm install' ? 300_000 : 180_000,
      'unrestricted',
      undefined,
      state.settings.defaultShell,
    )
    process.stdout.write(`${truncate(output.trim() || '(no output)', 1200)}\n`)
  }
  ok('RoyCode self-upgrade completed')
  printDivider()
}

async function buildSecurityReviewPrompt(state: CliState, notes: string): Promise<string> {
  const status = await getGitStatus(state.settings.workspaceRoot)
  if (!status.isRepo) {
    return [
      'Perform a focused security review of the current workspace.',
      'Focus on high-confidence issues involving auth, secrets, injection, path traversal, unsafe shelling out, insecure deserialization, and data exposure.',
      notes.trim(),
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const [gitStatus, unstagedDiff, stagedDiff, recentLog] = await Promise.all([
    runWorkspaceCommand(
      state.settings.workspaceRoot,
      'git status --short --branch',
      '.',
      15_000,
      state.settings.accessMode,
      undefined,
      state.settings.defaultShell,
    ).catch(() => ''),
    runWorkspaceCommand(
      state.settings.workspaceRoot,
      'git diff --no-ext-diff --submodule=diff -- .',
      '.',
      25_000,
      state.settings.accessMode,
      undefined,
      state.settings.defaultShell,
    ).catch(() => ''),
    runWorkspaceCommand(
      state.settings.workspaceRoot,
      'git diff --cached --no-ext-diff --submodule=diff -- .',
      '.',
      25_000,
      state.settings.accessMode,
      undefined,
      state.settings.defaultShell,
    ).catch(() => ''),
    runWorkspaceCommand(
      state.settings.workspaceRoot,
      'git log --oneline -n 10',
      '.',
      10_000,
      state.settings.accessMode,
      undefined,
      state.settings.defaultShell,
    ).catch(() => ''),
  ])

  return [
    'You are a senior security engineer performing a focused security review.',
    'Report only high-confidence, actionable security findings introduced or exposed by the current changes.',
    'Ignore style issues, low-confidence speculation, generic best-practice advice, and purely theoretical concerns.',
    'Prioritize auth/authorization issues, secrets exposure, command injection, path traversal, unsafe file operations, deserialization, insecure eval, SSRF host/protocol control, and sensitive data leakage.',
    notes.trim() ? `Additional user instructions:\n${notes.trim()}` : '',
    'Repository status:',
    '```text',
    gitStatus.trim() || '(no git status output)',
    '```',
    'Recent commits:',
    '```text',
    recentLog.trim() || '(no recent commits)',
    '```',
    'Unstaged diff:',
    '```diff',
    unstagedDiff.trim() || '(none)',
    '```',
    'Staged diff:',
    '```diff',
    stagedDiff.trim() || '(none)',
    '```',
    'Return findings first in markdown. For each finding include file, severity, category, exploit scenario, and fix recommendation.',
    'If there are no findings, say so explicitly and mention any residual blind spots or missing tests.',
  ]
    .filter(Boolean)
    .join('\n')
}

async function handleBranchCommand(state: CliState, rawArgs: string): Promise<void> {
  await saveCurrentSession(state)
  const sessions = await listCliSessions()
  const existingTitles = new Set(sessions.map(session => session.title.toLowerCase()))
  const nextTitle = makeUniqueSessionTitle(
    buildBranchTitleBase(state.sessionTitle, stripWrappingQuotes(rawArgs)),
    existingTitles,
  )

  state.sessionId = createSessionId()
  state.sessionTitle = nextTitle
  state.sessionCreatedAt = new Date().toISOString()
  state.pendingAttachments = []
  state.explicitTitle = true
  state.sessionTouched = true

  await saveCurrentSession(state)
  ok(`Created branched session ${state.sessionId} (${state.sessionTitle})`)
}

async function handleSummaryCommand(state: CliState, rawArgs: string): Promise<void> {
  const summary = await buildConversationSummary(state, rawArgs.trim())
  if (!summary) {
    info('Nothing to summarize in the current session')
    return
  }

  printDivider()
  process.stdout.write(`${label('Session Summary')}\n\n${summary}\n`)
  printDivider()
}

async function handleThinkbackCommand(state: CliState): Promise<void> {
  const summary = await buildThinkbackSummary(state)
  printThinkbackSummary(summary)
}

async function handleSessionCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'info' || action === 'show' || action === 'status') {
    printStatus(state)
    return
  }
  if (action === 'branch') {
    await handleBranchCommand(state, rest)
    return
  }
  if (action === 'summary') {
    await handleSummaryCommand(state, rest)
    return
  }
  if (action === 'thinkback' || action === 'insights') {
    await handleThinkbackCommand(state)
    return
  }
  if (action === 'export') {
    await handleExportCommand(state, rest)
    return
  }
  if (action === 'resume') {
    await handleResumeCommand(state, rest)
    return
  }
  if (action === 'title' || action === 'rename') {
    await handleTitleCommand(state, rest)
    return
  }
  if (action === 'delete') {
    await handleDeleteSessionCommand(state, rest || 'current')
    return
  }
  fail('Usage: /session [info|branch [title]|summary [instructions]|thinkback|export [path]|resume <id>|title <text>|delete [current|id]]')
}

async function handleThemeCommand(state: CliState, rawArgs: string): Promise<void> {
  const nextTheme = rawArgs.trim().toLowerCase()
  if (!nextTheme) {
    info(`Current theme: ${state.settings.theme || 'dark'}`)
    info('Usage: /theme <dark|light|auto>')
    return
  }
  if (!['dark', 'light', 'auto'].includes(nextTheme)) {
    fail('Usage: /theme <dark|light|auto>')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    theme: nextTheme as AppSettings['theme'],
  }))
  await runHookSafely('config-changed', state, {
    configKey: 'theme',
    configValue: nextTheme,
  })
  ok(`Theme set to ${nextTheme}`)
}

async function handleColorCommand(rawArgs: string): Promise<void> {
  const action = rawArgs.trim().toLowerCase()
  if (!action || action === 'status') {
    info(`Color mode is ${colorModeOverride} (${supportsColor() ? 'enabled' : 'disabled'})`)
    info('Usage: /color <on|off|auto|test>')
    return
  }
  if (action === 'test') {
    process.stdout.write(
      `${green('green')} ${yellow('yellow')} ${blue('blue')} ${magenta('magenta')} ${cyan('cyan')}\n`,
    )
    return
  }
  if (!['on', 'off', 'auto'].includes(action)) {
    fail('Usage: /color <on|off|auto|test>')
    return
  }
  colorModeOverride = action as typeof colorModeOverride
  ok(`Color mode set to ${action}`)
}

async function handleEffortCommand(state: CliState, rawArgs: string): Promise<void> {
  const action = rawArgs.trim().toLowerCase()
  const envOverride = getEffortEnvOverride()
  if (!action || action === 'status' || action === 'current') {
    const effective = resolveEffortLevel(state.settings)
    info(`Effort level is ${effective}`)
    info(describeEffortLevel(effective))
    if (envOverride) {
      warn(`Environment override is active: ${envOverride}`)
    }
    return
  }
  if (!['auto', 'low', 'medium', 'high', 'max'].includes(action)) {
    fail('Usage: /effort <auto|low|medium|high|max>')
    return
  }
  await updateSettings(state, settings => ({
    ...settings,
    effortLevel: action as EffortLevel,
  }))
  await runHookSafely('config-changed', state, {
    configKey: 'effortLevel',
    configValue: action,
  })
  ok(`Effort level set to ${action}`)
  if (envOverride && envOverride !== action) {
    warn(`Current session still follows environment override ${envOverride}`)
  }
}

async function handleVimCommand(state: CliState, rawArgs: string): Promise<void> {
  const action = rawArgs.trim().toLowerCase()
  if (!action || action === 'status') {
    info(`Vim mode is ${(state.settings.vimMode ?? false) ? 'on' : 'off'}`)
    info('Usage: /vim <on|off|toggle>')
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    nextValue = !(state.settings.vimMode ?? false)
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /vim <on|off|toggle>')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    vimMode: nextValue,
  }))
  await runHookSafely('config-changed', state, {
    configKey: 'vimMode',
    configValue: String(nextValue),
  })
  ok(`Vim mode ${nextValue ? 'enabled' : 'disabled'}`)
}

async function handleBriefCommand(state: CliState, rawArgs: string): Promise<void> {
  const action = rawArgs.trim().toLowerCase()
  if (!action || action === 'status') {
    info(`Brief mode is ${(state.settings.briefMode ?? false) ? 'on' : 'off'}`)
    info('Usage: /brief <on|off|toggle>')
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    nextValue = !(state.settings.briefMode ?? false)
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /brief <on|off|toggle>')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    briefMode: nextValue,
  }))
  await runHookSafely('config-changed', state, {
    configKey: 'briefMode',
    configValue: String(nextValue),
  })
  ok(`Brief mode ${nextValue ? 'enabled' : 'disabled'}`)
}

async function handleSuggestCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action || action === 'show' || action === 'list') {
    state.lastSuggestions = buildPromptSuggestions(buildSuggestionContext(state))
    printSuggestions(state)
    return
  }

  if (action === 'status') {
    info(
      `Prompt suggestions are ${state.settings.promptSuggestionEnabled === false ? 'off' : 'on'}`,
    )
    info(`${state.lastSuggestions.length} cached suggestions`)
    return
  }

  if (action === 'run' || action === 'send' || action === 'use') {
    const index = Number.parseInt(rest.trim(), 10)
    if (!Number.isFinite(index) || index < 1 || index > state.lastSuggestions.length) {
      fail('Usage: /suggest run <index>')
      return
    }
    const suggestion = state.lastSuggestions[index - 1] as string
    info(`Running suggestion ${index}: ${suggestion}`)
    await runPromptInternal(state, suggestion, {
      source: 'cli',
    })
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    nextValue = !(state.settings.promptSuggestionEnabled !== false)
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /suggest [show|run <index>|on|off|toggle|status]')
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    promptSuggestionEnabled: nextValue,
  }))
  ok(`Prompt suggestions ${nextValue ? 'enabled' : 'disabled'}`)
}

async function handleVoiceCommand(state: CliState, rawArgs: string): Promise<void> {
  const support = describeVoiceSupport()
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action || action === 'status') {
    info(`Voice mode is ${(state.settings.voiceMode ?? false) ? 'on' : 'off'}`)
    info(`Voice backend: ${support.mode}`)
    info(`Voice input: ${support.inputSupported ? 'supported' : 'unsupported'}`)
    info(`Voice output: ${support.outputSupported ? 'supported' : 'unsupported'}`)
    return
  }

  if (action === 'say') {
    if (!rest) {
      fail('Usage: /voice say <text>')
      return
    }
    await speakText(rest)
    ok('Spoke text through the local voice backend')
    return
  }

  if (action === 'listen') {
    const timeout = Number.parseInt(rest.trim() || '8', 10) || 8
    info(`Listening for up to ${timeout} seconds...`)
    const result = await listenForSpeech(timeout)
    printDivider()
    process.stdout.write(`${label('Voice Input')}\n${result.text}\n`)
    printDivider()
    return
  }

  if (action === 'prompt') {
    const timeout = Number.parseInt(rest.trim() || '8', 10) || 8
    info(`Listening for a prompt for up to ${timeout} seconds...`)
    const result = await listenForSpeech(timeout)
    ok(`Captured prompt: ${truncate(result.text, 120)}`)
    await runPromptInternal(state, result.text, {
      source: 'cli',
    })
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    nextValue = !(state.settings.voiceMode ?? false)
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /voice <on|off|toggle|status|say <text>|listen [seconds]|prompt [seconds]>')
    return
  }

  if (nextValue && !support.supported) {
    fail(`Voice mode is not supported on this platform (${support.mode})`)
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    voiceMode: nextValue,
  }))
  await runHookSafely('config-changed', state, {
    configKey: 'voiceMode',
    configValue: String(nextValue),
  })
  ok(`Voice mode ${nextValue ? 'enabled' : 'disabled'}`)
}

async function handleNotificationsCommand(
  state: CliState,
  rawArgs: string,
): Promise<void> {
  const support = describeNotifierSupport()
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'status') {
    info(
      `Notifications are ${(state.settings.notificationsEnabled ?? false) ? 'on' : 'off'}`,
    )
    info(`Notification backend: ${support.mode}`)
    return
  }

  if (action === 'test') {
    const message = rest || 'RoyCode test notification'
    await sendLocalNotification('RoyCode', message)
    ok('Sent a local notification')
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    nextValue = !(state.settings.notificationsEnabled ?? false)
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /notifications <on|off|toggle|status|test [text]>')
    return
  }

  if (nextValue && !support.supported) {
    fail(`Notifications are not supported on this platform (${support.mode})`)
    return
  }

  await updateSettings(state, settings => ({
    ...settings,
    notificationsEnabled: nextValue,
  }))
  ok(`Notifications ${nextValue ? 'enabled' : 'disabled'}`)
}

async function handleNotifyCommand(rawArgs: string): Promise<void> {
  const text = rawArgs.trim()
  if (!text) {
    fail('Usage: /notify <text>')
    return
  }
  await sendLocalNotification('RoyCode', text)
  ok('Sent a local notification')
}

async function handleSleepGuardCommand(
  state: CliState,
  rawArgs: string,
): Promise<void> {
  const { action } = parseCommandTarget(rawArgs)
  if (!action || action === 'status') {
    const status = await getSleepGuardStatus()
    info(`Sleep guard is ${status.enabled ? 'on' : 'off'}`)
    info(`Sleep guard backend: ${status.mode}`)
    return
  }

  let nextValue: boolean
  if (action === 'toggle') {
    const status = await getSleepGuardStatus()
    nextValue = !status.enabled
  } else if (action === 'on' || action === 'enable' || action === 'enabled') {
    nextValue = true
  } else if (action === 'off' || action === 'disable' || action === 'disabled') {
    nextValue = false
  } else {
    fail('Usage: /sleep-guard <on|off|toggle|status>')
    return
  }

  const status = nextValue ? await enableSleepGuard() : await disableSleepGuard()
  await updateSettings(state, settings => ({
    ...settings,
    sleepGuardMode: nextValue,
  }))
  ok(
    `Sleep guard ${status.enabled ? 'enabled' : 'disabled'} (${status.mode})`,
  )
}

async function handleUsageCommand(rawArgs: string): Promise<void> {
  const windowDays = parseUsageWindowDays(rawArgs)
  await printUsageSummary(windowDays)
}

async function handleCostCommand(rawArgs: string): Promise<void> {
  const windowDays = parseUsageWindowDays(rawArgs)
  await printCostSummary(windowDays)
}

async function handleStatsCommand(state: CliState): Promise<void> {
  await printRuntimeStats(state)
}

async function handleAdvisorCommand(
  state: CliState,
  rawArgs: string,
): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'status') {
    const advisorModel = state.settings.advisorModel?.trim()
    if (!advisorModel) {
      info('Advisor model is not configured')
    } else {
      info(`Advisor model: ${advisorModel}`)
    }
    info('Usage: /advisor <model>|off|status|review [text]')
    return
  }

  if (action === 'off' || action === 'unset' || action === 'disable') {
    await updateSettings(state, settings => ({
      ...settings,
      advisorModel: '',
    }))
    ok('Advisor model disabled')
    return
  }

  if (action === 'review' || action === 'ask' || action === 'run') {
    const advisorModel = state.settings.advisorModel?.trim()
    if (!advisorModel) {
      fail('Set an advisor model first with /advisor <model>')
      return
    }
    const latestUser = [...state.messages].reverse().find(message => message.role === 'user')
    const latestAssistant = [...state.messages]
      .reverse()
      .find(message => message.role === 'assistant')
    const reviewTarget =
      rest.trim() ||
      [
        latestUser ? `Latest user request:\n${typeof latestUser.content === 'string' ? latestUser.content : ''}` : '',
        latestAssistant
          ? `Latest assistant answer:\n${typeof latestAssistant.content === 'string' ? latestAssistant.content : ''}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n')

    if (!reviewTarget) {
      fail('Usage: /advisor review [text]')
      return
    }

    await runPromptInternal(
      state,
      `Review the following content as a secondary advisor. Focus on gaps, risks, missed verification, and better next steps.\n\n${reviewTarget}`,
      {
        isolated: true,
        modelOverride: advisorModel,
        source: 'advisor',
        extraSystemAddenda: [
          'You are acting as RoyCode advisor mode.',
          'Do not use tools unless strictly necessary.',
          'Give a second-opinion critique that improves the main answer.',
        ],
      },
    )
    return
  }

  const nextModel = stripWrappingQuotes(rawArgs).trim()
  if (!nextModel) {
    fail('Usage: /advisor <model>|off|status|review [text]')
    return
  }
  await updateSettings(state, settings => ({
    ...settings,
    advisorModel: nextModel,
  }))
  ok(`Advisor model set to ${nextModel}`)
}

async function handleVersionCommand(state: CliState): Promise<void> {
  await printVersionInfo(state)
}

async function handleReleaseNotesCommand(
  state: CliState,
  rawArgs: string,
): Promise<void> {
  const parsed = Number.parseInt(rawArgs.trim(), 10)
  await printLocalReleaseNotes(state, Number.isFinite(parsed) ? parsed : MAX_RELEASE_NOTES)
}

async function handleUpgradeCommand(state: CliState, rawArgs: string): Promise<void> {
  const action = rawArgs.trim().toLowerCase()
  if (!action || action === 'status' || action === 'check') {
    await printUpgradeStatus(state)
    return
  }
  if (action === 'run') {
    await runRoyCodeUpgrade(state)
    return
  }
  fail('Usage: /upgrade [status|run]')
}

async function handleSecurityReviewCommand(
  state: CliState,
  rawArgs: string,
): Promise<void> {
  const prompt = await buildSecurityReviewPrompt(state, rawArgs)
  await runPromptInternal(state, prompt, {
    extraSystemAddenda: [
      'You are in RoyCode security-review mode.',
      'This is a read-only specialist review. Do not edit files, mutate git state, or change runtime settings.',
      'Focus on concrete security vulnerabilities with exploitability reasoning. Findings first.',
    ],
    disallowedTools: [
      'write_file',
      'replace_in_file',
      'set_config',
      'todo_write',
      'create_task',
      'update_task',
      'stop_task',
      'restart_task',
      'create_cron_task',
      'delete_cron_task',
      'create_worktree',
      'remove_worktree',
      'edit_notebook_cell',
      'add_notebook_cell',
      'delete_notebook_cell',
      'create_team',
      'create_team_tasks',
      'run_subagent',
    ],
  })
}

function renderStatusline(state: CliState): string {
  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const parts = [
    `session ${state.sessionTitle}`,
    `workspace ${state.settings.workspaceRoot}`,
    `cwd ${state.cwd}`,
    `provider ${provider.id}`,
    `model ${model || 'none'}`,
    `mode ${describeExecutionMode(state)}`,
    `effort ${resolveEffortLevel(state.settings)}`,
    `brief ${(state.settings.briefMode ?? false) ? 'on' : 'off'}`,
    `voice ${(state.settings.voiceMode ?? false) ? 'on' : 'off'}`,
    `suggest ${state.settings.promptSuggestionEnabled !== false ? 'on' : 'off'}`,
    `notify ${(state.settings.notificationsEnabled ?? false) ? 'on' : 'off'}`,
    `safe-write ${state.settings.safeWriteMode ? 'on' : 'off'}`,
  ]
  return parts.join(' | ')
}

function handleStatuslineCommand(state: CliState): void {
  process.stdout.write(`${renderStatusline(state)}\n`)
}

function handleKeybindingsCommand(): void {
  printKeyValueBlock('RoyCode TUI Keybindings', [
    { label: 'Ctrl+R', value: '/status' },
    { label: 'Ctrl+W', value: '/context' },
    { label: 'Ctrl+G', value: '/git' },
    { label: 'Ctrl+P', value: '/pending' },
    { label: 'Ctrl+J', value: '/suggest' },
    { label: 'Ctrl+Y', value: '/cron' },
    { label: 'Ctrl+K', value: '/worktree' },
    { label: 'Ctrl+O', value: '/plan-mode status' },
    { label: 'Ctrl+L', value: 'clear local TUI view' },
    { label: 'Ctrl+C', value: 'exit RoyCode' },
  ])
}

async function handleChromeCommand(rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    info('Usage: /chrome open <url> | /chrome search <query> | /chrome review <url>')
    return
  }

  if (action === 'open') {
    if (!rest) {
      fail('Usage: /chrome open <url>')
      return
    }
    await openUrlInBrowser(stripWrappingQuotes(rest))
    ok('Opened URL in the default browser')
    return
  }

  if (action === 'search') {
    if (!rest) {
      fail('Usage: /chrome search <query>')
      return
    }
    await openUrlInBrowser(buildBrowserSearchUrl(rest))
    ok('Opened browser search')
    return
  }

  if (action === 'review' || action === 'fetch') {
    if (!rest) {
      fail('Usage: /chrome review <url>')
      return
    }
    const result = await webFetch(stripWrappingQuotes(rest))
    printDivider()
    process.stdout.write(`${label(result.title)}\n${dim(result.url)}\n\n${result.text}\n`)
    printDivider()
    return
  }

  fail('Usage: /chrome open <url> | /chrome search <query> | /chrome review <url>')
}

async function handleSettingsSyncCommand(rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'status') {
    const status = await describeSettingsSync()
    printKeyValueBlock('Settings Sync', [
      { label: 'data-dir', value: status.dataDir },
      { label: 'json-files', value: String(status.fileEntries.length) },
      { label: 'directory-files', value: String(status.directoryEntries.length) },
      { label: 'total', value: String(status.totalEntries) },
    ])
    return
  }

  if (action === 'export') {
    const tokens = tokenizeQuotedArgs(rest)
    const targetPath = tokens.find(token => !token.startsWith('--'))
    if (!targetPath) {
      fail('Usage: /settings-sync export <path> [--redact-secrets]')
      return
    }
    const result = await exportSettingsBundle(targetPath, {
      redactSecrets: tokens.includes('--redact-secrets'),
    })
    ok(
      `Exported settings sync bundle to ${result.bundlePath} (${result.entryCount} entries${result.redacted ? ', redacted' : ''})`,
    )
    return
  }

  if (action === 'import') {
    const targetPath = stripWrappingQuotes(rest).trim()
    if (!targetPath) {
      fail('Usage: /settings-sync import <path>')
      return
    }
    const result = await importSettingsBundle(targetPath)
    ok(`Imported ${result.entryCount} sync entries from ${result.bundlePath}`)
    return
  }

  fail('Usage: /settings-sync [status|export <path> [--redact-secrets]|import <path>]')
}

async function handleRemoteTriggerCommand(rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'list') {
    const triggers = await listRemoteTriggers()
    if (!triggers.length) {
      info('No remote triggers configured')
      return
    }
    for (const trigger of triggers) {
      process.stdout.write(
        `- ${trigger.name} ${dim(`[${trigger.method}]`)} ${dim(trigger.url)} ${trigger.enabled ? green('enabled') : red('disabled')}\n`,
      )
    }
    return
  }

  if (action === 'add') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    const url = tokens.shift()
    if (!name || !url) {
      fail('Usage: /remote-trigger add <name> <url> [POST|PUT] [token]')
      return
    }
    const maybeMethod = (tokens[0] || '').toUpperCase()
    const method =
      maybeMethod === 'PUT' || maybeMethod === 'POST'
        ? (tokens.shift() as 'POST' | 'PUT')
        : undefined
    const trigger = await addRemoteTrigger({
      name,
      url,
      method,
      token: tokens.shift(),
    })
    ok(`Saved remote trigger ${trigger.name}`)
    return
  }

  if (action === 'enable' || action === 'disable') {
    const reference = rest.trim()
    if (!reference) {
      fail(`Usage: /remote-trigger ${action} <name>`)
      return
    }
    const trigger = await setRemoteTriggerEnabled(reference, action === 'enable')
    ok(`${trigger.name} ${action}d`)
    return
  }

  if (action === 'remove' || action === 'delete') {
    const reference = rest.trim()
    if (!reference) {
      fail('Usage: /remote-trigger remove <name>')
      return
    }
    await removeRemoteTrigger(reference)
    ok(`Removed remote trigger ${reference}`)
    return
  }

  if (action === 'run' || action === 'fire') {
    const match = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/)
    const reference = match?.[1]
    if (!reference) {
      fail('Usage: /remote-trigger run <name> [json]')
      return
    }
    const payload = parseOptionalJson(match?.[2] ?? '')
    const result = await fireRemoteTrigger({
      reference,
      payload,
    })
    process.stdout.write(
      `${result.status} ${result.ok ? green('OK') : red('FAIL')} ${truncate(result.body.replace(/\s+/g, ' '), 180)}\n`,
    )
    return
  }

  fail('Usage: /remote-trigger [list|add|enable|disable|remove|run] ...')
}

async function handleCompactCommand(state: CliState, rawArgs: string): Promise<void> {
  if (!state.messages.length && !state.compactSummaries.length) {
    info('Nothing to compact in the current session')
    return
  }

  const preHook = await runHookSafely('pre-compact', state, {
    commandArgs: rawArgs,
  })
  if (!preHook.continue) {
    warn(preHook.stopReason || 'Compact blocked by hook')
    return
  }

  const summary = await buildConversationCompactSummary(state, rawArgs.trim())
  if (!summary) {
    warn('Failed to build a compact summary')
    return
  }

  state.compactSummaries = [summary]
  state.messages = []
  state.pendingAttachments = []
  state.sessionTouched = true
  await saveCurrentSession(state)

  await runHookSafely('post-compact', state, {
    assistant: summary,
    commandArgs: rawArgs,
  })

  ok('Conversation compacted into one durable summary')
}

async function handleRewindCommand(state: CliState, rawArgs: string): Promise<void> {
  const trimmed = rawArgs.trim().toLowerCase()
  const turns =
    trimmed === 'all'
      ? countUserTurns(state.messages)
      : Math.max(1, Number.parseInt(trimmed || '1', 10) || 1)

  if (!state.messages.length) {
    info('No transcript turns to rewind')
    return
  }

  let remainingUserTurns = turns
  let cutIndex = state.messages.length

  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    if (state.messages[index]?.role === 'user') {
      remainingUserTurns -= 1
      if (remainingUserTurns <= 0) {
        cutIndex = index
        break
      }
    }
  }

  if (cutIndex >= state.messages.length) {
    warn('Could not find enough user turns to rewind')
    return
  }

  const removed = state.messages.length - cutIndex
  state.messages = state.messages.slice(0, cutIndex)
  state.pendingAttachments = []
  state.sessionTouched = true
  await saveCurrentSession(state)
  ok(`Rewound ${removed} transcript message(s)`)
}

async function handleExportCommand(state: CliState, rawArgs: string): Promise<void> {
  const requestedTarget = stripWrappingQuotes(rawArgs)
  const markdown = renderSessionMarkdown(state)

  if (
    requestedTarget &&
    (requestedTarget.toLowerCase() === 'clipboard' || requestedTarget.toLowerCase() === 'clip')
  ) {
    await copyTextToClipboard(markdown)
    ok('Session copied to clipboard')
    return
  }

  const baseDir = path.isAbsolute(state.cwd)
    ? path.resolve(state.cwd)
    : path.resolve(state.settings.workspaceRoot, state.cwd || '.')
  const defaultFileName = `${sanitizeFileSlug(state.sessionTitle)}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.md`
  const targetPath = path.isAbsolute(requestedTarget)
    ? path.resolve(requestedTarget)
    : path.resolve(baseDir, requestedTarget || defaultFileName)
  const extension = path.extname(targetPath).toLowerCase()
  const content =
    extension === '.json'
      ? `${JSON.stringify(
          {
            id: state.sessionId,
            title: state.sessionTitle,
            createdAt: state.sessionCreatedAt,
            workspaceRoot: state.settings.workspaceRoot,
            cwd: state.cwd,
            activeSkills: state.activeSkills,
            compactSummaries: state.compactSummaries,
            messages: state.messages,
          },
          null,
          2,
        )}\n`
      : markdown

  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  ok(`Exported session to ${targetPath}`)
}

async function handleHooksCommand(): Promise<void> {
  const hooks = await listHooks()
  printHooksList(hooks)
}

async function handleHookCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    info(`Events: ${HOOK_EVENTS.join(', ')}`)
    info('Usage: /hook add <event> <command> [--match <text>] | /hook set <event> <command> [--match <text>] | /hook clear <event> | /hook remove <id> | /hook enable <id> | /hook disable <id>')
    return
  }

  if (action === 'add' || action === 'set') {
    const parts = rest.trim().split(/\s+/)
    const event = parts[0] as HookEventName | undefined
    const parsed = parseHookCommandSpec(rest.slice(parts[0]?.length ?? 0).trim())
    if (!event || !HOOK_EVENTS.includes(event)) {
      fail(`Expected hook event: ${HOOK_EVENTS.join(', ')}`)
      return
    }
    if (!parsed.command) {
      fail(`Usage: /hook ${action} <event> <command> [--match <text>]`)
      return
    }
    const hook =
      action === 'set'
        ? await setHook(event, parsed.command, parsed.matcher)
        : await addHook(event, parsed.command, parsed.matcher)
    ok(`${action === 'set' ? 'Replaced' : 'Added'} hook ${hook.id} for ${event}`)
    return
  }

  if (action === 'clear' || action === 'unset' || action === 'remove') {
    const reference = rest.trim()
    if (!reference) {
      fail(`Usage: /hook ${action} <event|id>`)
      return
    }
    if (HOOK_EVENTS.includes(reference as HookEventName)) {
      await clearHook(reference as HookEventName)
      ok(`Hook(s) cleared for ${reference}`)
      return
    }
    await removeHook(reference)
    ok(`Hook removed: ${reference}`)
    return
  }

  if (action === 'enable' || action === 'disable') {
    const reference = rest.trim()
    if (!reference) {
      fail(`Usage: /hook ${action} <id>`)
      return
    }
    await setHookEnabled(reference, action === 'enable')
    ok(`Hook ${action}d: ${reference}`)
    return
  }

  fail('Usage: /hook add <event> <command> [--match <text>] | /hook set <event> <command> [--match <text>] | /hook clear <event> | /hook remove <id> | /hook enable <id> | /hook disable <id>')
}

async function handleSkillsCommand(state: CliState): Promise<void> {
  const skills = await listLocalSkills(state.settings.workspaceRoot, state.cwd)
  printSkillList(skills, state.activeSkills)
}

async function handleCommandsCommand(state: CliState, rawArgs = ''): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (action === 'show' && rest) {
    const localCommand = await getLocalCompatCommand(
      rest,
      state.settings.workspaceRoot,
      state.cwd,
    )
    if (!localCommand) {
      fail(`Command not found: ${rest}`)
      return
    }
    printDivider()
    process.stdout.write(
      `${label(localCommand.name)}\n${dim(localCommand.filePath)}\n\n${localCommand.content}\n`,
    )
    printDivider()
    return
  }

  const localCommands = await listLocalCompatCommands(state.settings.workspaceRoot, state.cwd)
  const pluginCommands = await listPluginCommands()
  printCompatCommandList(localCommands, pluginCommands)
}

async function handleAgentsCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    const agents = await listLocalAgents(state.settings.workspaceRoot, state.cwd)
    printAgentList(agents)
    return
  }

  if (action === 'show') {
    if (!rest) {
      fail('Usage: /agent show <name>')
      return
    }
    const agent = await getLocalAgent(rest, state.settings.workspaceRoot, state.cwd)
    if (!agent) {
      fail(`Agent not found: ${rest}`)
      return
    }
    printDivider()
    process.stdout.write(`${label(agent.name)}\n${dim(agent.filePath)}\n\n${agent.prompt}\n`)
    if (agent.memory) {
      const memory = await readAgentMemory(
        agent.name,
        agent.memory,
        state.settings.workspaceRoot,
        state.cwd,
      )
      process.stdout.write(
        `\n${label('Agent Memory')} ${dim(memory.path)}\n${memory.content || dim('(empty)')}\n`,
      )
    }
    printDivider()
    return
  }

  if (action === 'run') {
    const match = rest.match(/^(".*?"|'.*?'|\S+)(?:\s+([\s\S]+))?$/)
    const agentName = match?.[1] ? stripWrappingQuotes(match[1]) : ''
    const prompt = match?.[2]?.trim() || ''
    if (!agentName || !prompt) {
      fail('Usage: /agent run <name> <prompt>')
      return
    }
    const agent = await getLocalAgent(agentName, state.settings.workspaceRoot, state.cwd)
    if (!agent) {
      fail(`Agent not found: ${agentName}`)
      return
    }
    const options = await buildAgentPromptRunOptions(state, agent, [
      `This execution was launched from /agent run for ${agent.name}.`,
    ])
    await runCliSubagentPrompt(state, agent.name, prompt, options)
    return
  }

  fail('Usage: /agents | /agent show <name> | /agent run <name> <prompt>')
}

async function handleInstructionsCommand(state: CliState): Promise<void> {
  const files = await listWorkspaceInstructionFiles(
    state.settings.workspaceRoot,
    state.settings.accessMode,
    state.cwd,
  )
  if (!files.length) {
    info('No workspace instruction files found')
    return
  }

  for (const file of files) {
    printDivider()
    process.stdout.write(`${label(file.label)}\n${dim(file.path)}\n\n${file.content}\n`)
  }
  printDivider()
}

async function handleMemoryCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    const memory = await readWorkspaceMemory(state.settings.workspaceRoot)
    printDivider()
    process.stdout.write(`${label(memory.label)}\n${dim(memory.path)}\n\n${memory.content}\n`)
    printDivider()
    return
  }

  if (action === 'set') {
    if (!rest) {
      fail('Usage: /memory set <text>')
      return
    }
    const memory = await writeWorkspaceMemory(state.settings.workspaceRoot, rest)
    ok(`Workspace memory updated: ${memory.path}`)
    return
  }

  if (action === 'append') {
    if (!rest) {
      fail('Usage: /memory append <text>')
      return
    }
    const memory = await appendWorkspaceMemory(state.settings.workspaceRoot, rest)
    ok(`Workspace memory appended: ${memory.path}`)
    return
  }

  if (action === 'clear' || action === 'reset') {
    const memory = await writeWorkspaceMemory(
      state.settings.workspaceRoot,
      '# Workspace Memory\n',
    )
    ok(`Workspace memory reset: ${memory.path}`)
    return
  }

  if (action === 'extract') {
    const extracted = await buildWorkspaceMemoryExtraction(state, rest)
    if (!extracted) {
      info('Nothing to extract from the current session')
      return
    }
    const memory = await appendWorkspaceMemory(state.settings.workspaceRoot, extracted)
    printDivider()
    process.stdout.write(`${label('Extracted Workspace Memory')}\n\n${extracted}\n`)
    printDivider()
    ok(`Workspace memory updated: ${memory.path}`)
    return
  }

  fail('Usage: /memory | /memory set <text> | /memory append <text> | /memory clear | /memory extract [instructions]')
}

async function handleContextCommand(state: CliState): Promise<void> {
  const [
    instructions,
    memory,
    rules,
    customOutputStyles,
    pluginOutputStyles,
    availableOutputStyles,
    selectedOutputStyle,
    skills,
    commands,
    agents,
    plugins,
    pluginCommands,
    mcpServers,
    todos,
    projectMcpJson,
  ] = await Promise.all([
    listWorkspaceInstructionFiles(
      state.settings.workspaceRoot,
      state.settings.accessMode,
      state.cwd,
    ),
    readWorkspaceMemory(state.settings.workspaceRoot),
    getApplicableRules(state.settings.workspaceRoot, state.cwd),
    listLocalOutputStyles(state.settings.workspaceRoot, state.cwd),
    listPluginOutputStyles(),
    listAvailableOutputStyles(state.settings.workspaceRoot, state.cwd),
    getOutputStyleConfig(state.settings.outputStyle, state.settings.workspaceRoot, state.cwd),
    listLocalSkills(state.settings.workspaceRoot, state.cwd),
    listLocalCompatCommands(state.settings.workspaceRoot, state.cwd),
    listLocalAgents(state.settings.workspaceRoot, state.cwd),
    listInstalledPlugins(),
    listPluginCommands(),
    listMcpServers(
      state.settings.enableAllProjectMcpServers === false ? undefined : state.settings.workspaceRoot,
    ),
    readSessionTodos(resolveSessionTodoId(state)),
    inspectProjectMcpJson(state.settings.workspaceRoot),
  ])

  printDivider()
  process.stdout.write(`${label('Context Snapshot')}\n`)
  process.stdout.write(
    [
      `${label('workspace')} ${state.settings.workspaceRoot}`,
      `${label('cwd')} ${state.cwd}`,
      `${label('access')} ${state.settings.accessMode}`,
      `${label('safe-write')} ${state.settings.safeWriteMode ? 'on' : 'off'}`,
      `${label('output-style')} ${
        selectedOutputStyle ? `${selectedOutputStyle.name} [${selectedOutputStyle.source}]` : DEFAULT_OUTPUT_STYLE_NAME
      }`,
      `${label('provider')} ${getSelectedProvider(state.settings).id}`,
      `${label('model')} ${resolveModel(state.settings, getSelectedProvider(state.settings))}`,
      `${label('todos')} ${todos.length}`,
      `${label('skills')} ${skills.length}`,
      `${label('commands')} ${commands.length}`,
      `${label('agents')} ${agents.length}`,
      `${label('plugins')} ${plugins.length}`,
      `${label('plugin-commands')} ${pluginCommands.length}`,
      `${label('mcp')} ${mcpServers.length}`,
    ].join(` ${dim('|')} `) + '\n\n',
  )

  process.stdout.write(`${label('Instructions')}\n`)
  if (!instructions.length) {
    process.stdout.write(`${dim('(none)')}\n`)
  } else {
    for (const file of instructions) {
      process.stdout.write(`- ${file.label} ${dim(file.path)}\n`)
    }
  }
  process.stdout.write('\n')

  process.stdout.write(`${label('Workspace Memory')}\n`)
  process.stdout.write(`${dim(memory.path)}\n`)
  process.stdout.write(`${truncate(memory.content.replace(/\s+/g, ' '), 220)}\n\n`)

  process.stdout.write(`${label('Applicable Rules')}\n`)
  printRuleList(rules)
  process.stdout.write('\n')

  process.stdout.write(`${label('Custom Output Styles')}\n`)
  printOutputStyleDocs(customOutputStyles)
  process.stdout.write('\n')

  process.stdout.write(`${label('Plugin Output Styles')}\n`)
  printOutputStyleDocs(
    pluginOutputStyles.map(style => ({
      name: style.name,
      filePath: style.filePath,
      description: style.description,
      source: 'plugin',
      prompt: style.prompt,
    })),
  )
  process.stdout.write('\n')

  process.stdout.write(`${label('Available Output Styles')}\n`)
  printAvailableOutputStylesList(
    availableOutputStyles
      .filter((style): style is NonNullable<typeof style> => style !== null)
      .map(style => ({
        name: style.name,
        description: style.description,
        source: style.source,
      })),
    selectedOutputStyle?.name ?? DEFAULT_OUTPUT_STYLE_NAME,
  )
  process.stdout.write('\n')

  process.stdout.write(`${label('Project .mcp.json')}\n`)
  if (!projectMcpJson.path) {
    process.stdout.write(`${dim('(no workspace root)')}\n`)
  } else {
    process.stdout.write(
      `${projectMcpJson.path} ${dim(`exists=${projectMcpJson.exists} valid=${projectMcpJson.valid} servers=${projectMcpJson.serverCount}`)}\n`,
    )
    if (projectMcpJson.error) {
      process.stdout.write(`${red(projectMcpJson.error)}\n`)
    }
  }
  printDivider()
}

async function handleDoctorCommand(state: CliState): Promise<void> {
  const provider = getSelectedProvider(state.settings)
  const model = resolveModel(state.settings, provider)
  const findings: Array<{ level: 'ok' | 'warn'; message: string }> = []

  try {
    await buildFileTree(state.settings.workspaceRoot, '.', 0, state.settings.accessMode)
    findings.push({ level: 'ok', message: `Workspace is accessible: ${state.settings.workspaceRoot}` })
  } catch (error) {
    findings.push({
      level: 'warn',
      message: `Workspace is not accessible: ${error instanceof Error ? error.message : 'unknown error'}`,
    })
  }

  if (provider.apiKey) {
    findings.push({ level: 'ok', message: `Provider ${provider.id} has an API key configured` })
  } else {
    findings.push({ level: 'warn', message: `Provider ${provider.id} is missing an API key` })
  }

  if (model) {
    findings.push({ level: 'ok', message: `Selected model: ${model}` })
  } else {
    findings.push({ level: 'warn', message: 'No model is currently selected' })
  }

  const selectedOutputStyle = await getOutputStyleConfig(
    state.settings.outputStyle,
    state.settings.workspaceRoot,
    state.cwd,
  )
  if ((state.settings.outputStyle || DEFAULT_OUTPUT_STYLE_NAME) === DEFAULT_OUTPUT_STYLE_NAME) {
    findings.push({ level: 'ok', message: 'Using default output style' })
  } else if (selectedOutputStyle) {
    findings.push({
      level: 'ok',
      message: `Resolved output style ${selectedOutputStyle.name} from ${selectedOutputStyle.source}`,
    })
  } else {
    findings.push({
      level: 'warn',
      message: `Configured output style "${state.settings.outputStyle}" was not found`,
    })
  }

  const projectMcpJson = await inspectProjectMcpJson(state.settings.workspaceRoot)
  if (!projectMcpJson.exists) {
    findings.push({ level: 'ok', message: 'No project .mcp.json file found' })
  } else if (projectMcpJson.valid) {
    findings.push({
      level: 'ok',
      message: `Project .mcp.json is valid with ${projectMcpJson.serverCount} server(s)`,
    })
  } else {
    findings.push({
      level: 'warn',
      message: `.mcp.json is invalid: ${projectMcpJson.error || 'unknown parse error'}`,
    })
  }

  const instructions = await listWorkspaceInstructionFiles(
    state.settings.workspaceRoot,
    state.settings.accessMode,
    state.cwd,
  )
  findings.push({
    level: 'ok',
    message: `${instructions.length} instruction file(s) loaded for the current context`,
  })

  const rules = await getApplicableRules(state.settings.workspaceRoot, state.cwd)
  findings.push({
    level: 'ok',
    message: `${rules.length} applicable rule document(s) matched the current cwd`,
  })

  const mcpServers = await listMcpServers(
    state.settings.enableAllProjectMcpServers === false ? undefined : state.settings.workspaceRoot,
  )
  findings.push({
    level: 'ok',
    message: `${mcpServers.length} MCP server(s) visible under current settings`,
  })

  printDivider()
  process.stdout.write(`${label('Doctor')}\n`)
  for (const finding of findings) {
    process.stdout.write(
      `${finding.level === 'ok' ? green('OK') : yellow('WARN')} ${finding.message}\n`,
    )
  }
  printDivider()
}

async function handleRulesCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    const rules = await getApplicableRules(state.settings.workspaceRoot, state.cwd)
    printRuleList(rules)
    return
  }

  if (action === 'all') {
    const rules = await listLocalRules(state.settings.workspaceRoot, state.cwd)
    printRuleList(rules)
    return
  }

  const targetName = action === 'show' ? rest : rawArgs
  if (!targetName) {
    fail('Usage: /rules | /rules all | /rules show <name>')
    return
  }

  const rules = await listLocalRules(state.settings.workspaceRoot, state.cwd)
  const rule =
    rules.find(item => item.name.toLowerCase() === targetName.toLowerCase()) ??
    rules.find(item => item.name.toLowerCase().startsWith(targetName.toLowerCase())) ??
    rules.find(item => item.name.toLowerCase().includes(targetName.toLowerCase()))
  if (!rule) {
    fail(`Rule not found: ${targetName}`)
    return
  }
  printDivider()
  process.stdout.write(`${label(rule.name)}\n${dim(rule.filePath)}\n\n${rule.content}\n`)
  printDivider()
}

async function handleOutputStyleCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    const styles = await listAvailableOutputStyles(state.settings.workspaceRoot, state.cwd)
    printAvailableOutputStylesList(
      styles
        .filter((style): style is NonNullable<typeof style> => style !== null)
        .map(style => ({
          name: style.name,
          description: style.description,
          source: style.source,
        })),
      state.settings.outputStyle || DEFAULT_OUTPUT_STYLE_NAME,
    )
    info('/output-style is a convenience alias. /config set outputStyle <name> works too.')
    return
  }

  if (action === 'show') {
    const style = await getOutputStyleConfig(rest, state.settings.workspaceRoot, state.cwd)
    if (!style) {
      fail(`Output style not found: ${rest}`)
      return
    }
    printDivider()
    process.stdout.write(`${label(style.name)}\n${dim(style.source)}\n\n${style.prompt}\n`)
    printDivider()
    return
  }

  const requested = action === 'set' ? rest : rawArgs
  if (!requested) {
    fail('Usage: /output-style | /output-style <name> | /output-style show <name> | /output-style default')
    return
  }

  const nextStyle =
    requested.trim().toLowerCase() === 'default' ? DEFAULT_OUTPUT_STYLE_NAME : requested.trim()
  await updateSettings(state, settings => ({
    ...settings,
    outputStyle: nextStyle,
  }))
  ok(`Output style set to ${nextStyle}`)
}

async function handleConfigCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action || action === 'list' || action === 'keys') {
    const entries = listSupportedConfigEntries(state.settings)
    for (const entry of entries) {
      const options = entry.options?.length ? ` ${dim(`options: ${entry.options.join(', ')}`)}` : ''
      process.stdout.write(
        `- ${entry.key} ${dim(`${formatJsonValue(entry.value)}`)}${options}\n`,
      )
    }
    return
  }

  if (action === 'get') {
    if (!rest) {
      fail('Usage: /config get <key>')
      return
    }
    const entry = getCompatConfigValue(state.settings, rest)
    if (!entry) {
      fail(`Unknown config setting: ${rest}`)
      return
    }
    process.stdout.write(
      `${entry.key} = ${formatJsonValue(entry.value)}${entry.options?.length ? ` ${dim(`[${entry.options.join(', ')}]`)}` : ''}\n`,
    )
    return
  }

  if (action === 'set') {
    const tokens = tokenizeQuotedArgs(rest)
    const key = tokens.shift()
    if (!key || !tokens.length) {
      fail('Usage: /config set <key> <value>')
      return
    }
    const value = parseConfigLiteral(tokens.join(' '))
    let appliedKey = key
    let newValue: unknown
    let previousValue: unknown
    await updateSettings(state, settings => {
      const result = setCompatConfigValue(settings, key, value)
      appliedKey = result.entry.key
      newValue = result.entry.value
      previousValue = result.previousValue
      return result.settings
    })
    await runHookSafely('config-changed', state, {
      configKey: appliedKey,
      configValue: String(newValue ?? ''),
    })
    if (appliedKey === 'workspaceRoot') {
      state.cwd = '.'
      const instructionFiles = await listWorkspaceInstructionFiles(
        state.settings.workspaceRoot,
        state.settings.accessMode,
        state.cwd,
      )
      await runHookSafely('instructions-loaded', state, {
        commandArgs: instructionFiles.map(file => file.path).join(', '),
      })
    }
    ok(
      `Updated ${appliedKey}: ${formatJsonValue(previousValue)} -> ${formatJsonValue(newValue)}`,
    )
    return
  }

  const directEntry = getCompatConfigValue(state.settings, action)
  if (directEntry && rest) {
    const value = parseConfigLiteral(rest)
    let newValue: unknown
    let previousValue: unknown
    await updateSettings(state, settings => {
      const result = setCompatConfigValue(settings, action, value)
      newValue = result.entry.value
      previousValue = result.previousValue
      return result.settings
    })
    await runHookSafely('config-changed', state, {
      configKey: directEntry.key,
      configValue: String(newValue ?? ''),
    })
    if (directEntry.key === 'workspaceRoot') {
      state.cwd = '.'
      const instructionFiles = await listWorkspaceInstructionFiles(
        state.settings.workspaceRoot,
        state.settings.accessMode,
        state.cwd,
      )
      await runHookSafely('instructions-loaded', state, {
        commandArgs: instructionFiles.map(file => file.path).join(', '),
      })
    }
    ok(
      `Updated ${directEntry.key}: ${formatJsonValue(previousValue)} -> ${formatJsonValue(newValue)}`,
    )
    return
  }

  if (directEntry) {
    process.stdout.write(`${directEntry.key} = ${formatJsonValue(directEntry.value)}\n`)
    return
  }

  fail('Usage: /config | /config get <key> | /config set <key> <value>')
}

async function handleAgentMemoryCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  if (!action) {
    info('Usage: /agent-memory show <agent> [scope] | /agent-memory set <agent> <scope> <text> | /agent-memory append <agent> <scope> <text>')
    return
  }

  if (action === 'show') {
    const tokens = tokenizeQuotedArgs(rest)
    const agentName = tokens.shift()
    const scope = normalizeAgentMemoryScope(tokens.shift() || 'project')
    if (!agentName || !scope) {
      fail('Usage: /agent-memory show <agent> [user|project|local]')
      return
    }
    const memory = await readAgentMemory(
      agentName,
      scope,
      state.settings.workspaceRoot,
      state.cwd,
    )
    printDivider()
    process.stdout.write(
      `${label(`${agentName} (${scope})`)}\n${dim(memory.path)}\n\n${memory.content || dim('(empty)')}\n`,
    )
    printDivider()
    return
  }

  if (action === 'set' || action === 'append') {
    const match = rest.match(/^(".*?"|'.*?'|\S+)\s+(user|project|local)\s+([\s\S]+)$/i)
    const agentName = match?.[1] ? stripWrappingQuotes(match[1]) : ''
    const scope = normalizeAgentMemoryScope(match?.[2] || '')
    const text = match?.[3]?.trim() || ''
    if (!agentName || !scope || !text) {
      fail(`Usage: /agent-memory ${action} <agent> <user|project|local> <text>`)
      return
    }
    const memory =
      action === 'set'
        ? await writeAgentMemory(agentName, scope, text, state.settings.workspaceRoot, state.cwd)
        : await appendAgentMemory(agentName, scope, text, state.settings.workspaceRoot, state.cwd)
    ok(`Updated agent memory: ${memory.path}`)
    return
  }

  fail('Usage: /agent-memory show <agent> [scope] | /agent-memory set <agent> <scope> <text> | /agent-memory append <agent> <scope> <text>')
}

async function handleTodosCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  const sessionId = resolveSessionTodoId(state)
  const todos = await readSessionTodos(sessionId)

  if (!action) {
    printTodoList(todos)
    return
  }

  if (action === 'clear') {
    await clearSessionTodos(sessionId)
    ok('Cleared session todos')
    return
  }

  if (action === 'add') {
    if (!rest) {
      fail('Usage: /todos add <text>')
      return
    }
    await writeSessionTodos(sessionId, [...todos, { content: rest, status: 'pending' }])
    ok(`Added todo: ${rest}`)
    return
  }

  if (['doing', 'in-progress', 'done', 'remove'].includes(action)) {
    const tokens = tokenizeQuotedArgs(rest)
    const index = Number.parseInt(tokens[0] || '', 10)
    if (!Number.isInteger(index) || index < 1 || index > todos.length) {
      fail(`Usage: /todos ${action} <index>`)
      return
    }
    const nextTodos = [...todos]
    if (action === 'remove') {
      nextTodos.splice(index - 1, 1)
    } else {
      nextTodos[index - 1] = {
        ...nextTodos[index - 1]!,
        status: action === 'done' ? 'completed' : 'in_progress',
      }
    }
    await writeSessionTodos(sessionId, nextTodos)
    ok(`Updated todo ${index}`)
    return
  }

  fail('Usage: /todos | /todos add <text> | /todos doing <index> | /todos done <index> | /todos remove <index> | /todos clear')
}

async function handleSkillCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    await handleSkillsCommand(state)
    return
  }

  if (action === 'use') {
    if (!rest) {
      fail('Usage: /skill use <name>')
      return
    }
    const skill = await getLocalSkill(rest, state.settings.workspaceRoot, state.cwd)
    if (!skill) {
      fail(`Skill not found: ${rest}`)
      return
    }
    state.activeSkills = [...new Set([...state.activeSkills, skill.name])]
    state.sessionTouched = true
    await saveCurrentSession(state)
    ok(`Activated skill ${skill.name}`)
    return
  }

  if (action === 'drop' || action === 'remove') {
    if (!rest) {
      fail('Usage: /skill drop <name|all>')
      return
    }
    if (rest.toLowerCase() === 'all') {
      state.activeSkills = []
      state.sessionTouched = true
      await saveCurrentSession(state)
      ok('Cleared all active skills')
      return
    }
    const before = state.activeSkills.length
    state.activeSkills = state.activeSkills.filter(
      item => item.toLowerCase() !== rest.trim().toLowerCase(),
    )
    if (state.activeSkills.length === before) {
      warn(`Skill was not active: ${rest}`)
      return
    }
    state.sessionTouched = true
    await saveCurrentSession(state)
    ok(`Dropped skill ${rest}`)
    return
  }

  if (action === 'show') {
    if (!rest) {
      fail('Usage: /skill show <name>')
      return
    }
    const skill = await getLocalSkill(rest, state.settings.workspaceRoot, state.cwd)
    if (!skill) {
      fail(`Skill not found: ${rest}`)
      return
    }
    printDivider()
    process.stdout.write(`${label(skill.name)}\n${dim(skill.filePath)}\n\n${skill.content}\n`)
    printDivider()
    return
  }

  if (action === 'import') {
    if (!rest) {
      fail('Usage: /skill import <path> [name]')
      return
    }
    const match = rest.match(/^(".*?"|'.*?'|\S+)(?:\s+(.+))?$/)
    const sourcePath = match?.[1] ? stripWrappingQuotes(match[1]) : ''
    const explicitName = match?.[2]?.trim()
    if (!sourcePath) {
      fail('Usage: /skill import <path> [name]')
      return
    }
    const skill = await importLocalSkill(sourcePath, explicitName)
    ok(`Imported skill ${skill.name}`)
    return
  }

  fail('Usage: /skill use <name> | /skill drop <name|all> | /skill show <name> | /skill import <path> [name]')
}

async function handlePluginsCommand(): Promise<void> {
  const plugins = await listInstalledPlugins()
  printPluginList(plugins)
}

async function handlePluginCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    await handlePluginsCommand()
    return
  }

  if (action === 'import') {
    if (!rest) {
      fail('Usage: /plugin import <path> [name]')
      return
    }
    const match = rest.match(/^(".*?"|'.*?'|\S+)(?:\s+(.+))?$/)
    const sourcePath = match?.[1] ? stripWrappingQuotes(match[1]) : ''
    const explicitName = match?.[2]?.trim()
    if (!sourcePath) {
      fail('Usage: /plugin import <path> [name]')
      return
    }
    const plugin = await importLocalPlugin(sourcePath, explicitName)
    ok(`Imported plugin ${plugin.name}`)
    return
  }

  if (action === 'enable' || action === 'disable') {
    if (!rest) {
      fail(`Usage: /plugin ${action} <name>`)
      return
    }
    const plugin = await setPluginEnabled(rest, action === 'enable')
    ok(`${plugin.enabled ? 'Enabled' : 'Disabled'} plugin ${plugin.name}`)
    return
  }

  if (action === 'remove' || action === 'delete') {
    if (!rest) {
      fail('Usage: /plugin remove <name>')
      return
    }
    await removePlugin(rest)
    ok(`Removed plugin ${rest}`)
    return
  }

  if (action === 'commands') {
    const commands = await listPluginCommands(rest || undefined)
    printPluginCommandList(
      commands.map(command => ({
        name: command.name,
        description: command.description,
        argumentHint: command.argumentHint,
      })),
    )
    return
  }

  if (action === 'show') {
    if (!rest) {
      fail('Usage: /plugin show <name>')
      return
    }
    const command = await getPluginCommand(rest)
    if (!command) {
      fail(`Plugin command not found: ${rest}`)
      return
    }
    printDivider()
    process.stdout.write(
      `${label(command.name)} ${dim(`[${command.kind}]`)}\n${dim(command.filePath)}\n\n${command.content}\n`,
    )
    printDivider()
    return
  }

  if (action === 'run') {
    const runArgs = tokenizeQuotedArgs(rest)
    const commandName = runArgs.shift()
    if (!commandName) {
      fail('Usage: /plugin run <name> [args]')
      return
    }
    const built = await buildPluginCommandPrompt(commandName, runArgs.join(' '), {
      workspaceRoot: state.settings.workspaceRoot,
      cwd: state.cwd,
      accessMode: state.settings.accessMode,
      sessionId: state.sessionId,
      executeShell: true,
    })
    if (!built) {
      fail(`Plugin command not found: ${commandName}`)
      return
    }
    await runCompatibleSlashCommand(state, built.command.name, runArgs.join(' '))
    return
  }

  fail(
    'Usage: /plugin import <path> [name] | /plugin enable <name> | /plugin disable <name> | /plugin remove <name> | /plugin commands [plugin] | /plugin show <name> | /plugin run <name> [args]',
  )
}

async function handleMcpCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)
  const visibleWorkspaceRoot =
    state.settings.enableAllProjectMcpServers === false ? undefined : state.settings.workspaceRoot

  if (!action) {
    const servers = await listMcpServers(visibleWorkspaceRoot)
    printMcpServerList(servers)
    return
  }

  if (action === 'add-stdio') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    const command = tokens.shift()
    if (!name || !command) {
      fail('Usage: /mcp add-stdio <name> <command> [args...]')
      return
    }
    const server = await addStdioMcpServer({
      name,
      command,
      args: tokens,
    })
    ok(`Added MCP stdio server ${server.name}`)
    return
  }

  if (action === 'add-http') {
    const tokens = tokenizeQuotedArgs(rest)
    const name = tokens.shift()
    const url = tokens.shift()
    if (!name || !url) {
      fail('Usage: /mcp add-http <name> <url>')
      return
    }
    const server = await addHttpMcpServer({
      name,
      url,
    })
    ok(`Added MCP HTTP server ${server.name}`)
    return
  }

  if (action === 'enable' || action === 'disable') {
    if (!rest) {
      fail(`Usage: /mcp ${action} <name>`)
      return
    }
    const server = await setMcpServerEnabled(rest, action === 'enable')
    ok(`${server.enabled ? 'Enabled' : 'Disabled'} MCP server ${server.name}`)
    return
  }

  if (action === 'remove' || action === 'delete') {
    if (!rest) {
      fail('Usage: /mcp remove <name>')
      return
    }
    await removeMcpServer(rest)
    ok(`Removed MCP server ${rest}`)
    return
  }

  if (action === 'inspect' || action === 'show') {
    if (!rest) {
      fail('Usage: /mcp inspect <server>')
      return
    }
    const server = await inspectMcpServer(rest, visibleWorkspaceRoot)
    printDivider()
    process.stdout.write(`${JSON.stringify(server, null, 2)}\n`)
    printDivider()
    return
  }

  if (action === 'set-header') {
    const tokens = tokenizeQuotedArgs(rest)
    const serverName = tokens.shift()
    const headerName = tokens.shift()
    const headerValue = tokens.join(' ').trim()
    if (!serverName || !headerName || !headerValue) {
      fail('Usage: /mcp set-header <server> <key> <value>')
      return
    }
    const server = await setMcpServerHeader(
      serverName,
      headerName,
      headerValue,
      visibleWorkspaceRoot,
    )
    ok(`Updated header ${headerName} on MCP server ${server.name}`)
    return
  }

  if (action === 'unset-header') {
    const tokens = tokenizeQuotedArgs(rest)
    const serverName = tokens.shift()
    const headerName = tokens.shift()
    if (!serverName || !headerName) {
      fail('Usage: /mcp unset-header <server> <key>')
      return
    }
    const server = await unsetMcpServerHeader(serverName, headerName, visibleWorkspaceRoot)
    ok(`Removed header ${headerName} from MCP server ${server.name}`)
    return
  }

  if (action === 'set-env') {
    const tokens = tokenizeQuotedArgs(rest)
    const serverName = tokens.shift()
    const envName = tokens.shift()
    const envValue = tokens.join(' ').trim()
    if (!serverName || !envName || !envValue) {
      fail('Usage: /mcp set-env <server> <key> <value>')
      return
    }
    const server = await setMcpServerEnv(serverName, envName, envValue, visibleWorkspaceRoot)
    ok(`Updated env ${envName} on MCP server ${server.name}`)
    return
  }

  if (action === 'unset-env') {
    const tokens = tokenizeQuotedArgs(rest)
    const serverName = tokens.shift()
    const envName = tokens.shift()
    if (!serverName || !envName) {
      fail('Usage: /mcp unset-env <server> <key>')
      return
    }
    const server = await unsetMcpServerEnv(serverName, envName, visibleWorkspaceRoot)
    ok(`Removed env ${envName} from MCP server ${server.name}`)
    return
  }

  if (action === 'bearer' || action === 'set-bearer') {
    const tokens = tokenizeQuotedArgs(rest)
    const serverName = tokens.shift()
    const token = tokens.join(' ').trim()
    if (!serverName || !token) {
      fail('Usage: /mcp bearer <server> <token>')
      return
    }
    const server = await setMcpServerBearerToken(serverName, token, visibleWorkspaceRoot)
    ok(`Updated bearer token on MCP server ${server.name}`)
    return
  }

  if (action === 'tools') {
    if (!rest) {
      fail('Usage: /mcp tools <server>')
      return
    }
    const tools = await listMcpTools(rest, visibleWorkspaceRoot)
    printPluginCommandList(
      tools.map(tool => ({
        name: tool.name,
        description: tool.description ?? 'No description available.',
      })),
    )
    return
  }

  if (action === 'prompts') {
    if (!rest) {
      fail('Usage: /mcp prompts <server>')
      return
    }
    const prompts = await listMcpPrompts(rest, visibleWorkspaceRoot)
    printPluginCommandList(
      prompts.map(prompt => ({
        name: prompt.name,
        description: prompt.description ?? 'No description available.',
      })),
    )
    return
  }

  if (action === 'resources') {
    if (!rest) {
      fail('Usage: /mcp resources <server>')
      return
    }
    const resources = await listMcpResources(rest, visibleWorkspaceRoot)
    if (!resources.length) {
      info('No MCP resources found')
      return
    }
    for (const resource of resources) {
      process.stdout.write(
        `${resource.uri} ${dim(resource.name)} ${resource.mimeType ? dim(resource.mimeType) : ''}\n`,
      )
    }
    return
  }

  if (action === 'call') {
    const match = rest.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/)
    const serverName = match?.[1]
    const toolName = match?.[2]
    if (!serverName || !toolName) {
      fail('Usage: /mcp call <server> <tool> [json]')
      return
    }
    const toolArgs = parseOptionalJson(match?.[3] ?? '')
    const result = await callMcpTool(serverName, toolName, toolArgs, visibleWorkspaceRoot)
    printDivider()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    printDivider()
    return
  }

  if (action === 'prompt') {
    const match = rest.match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/)
    const serverName = match?.[1]
    const promptName = match?.[2]
    if (!serverName || !promptName) {
      fail('Usage: /mcp prompt <server> <prompt> [json]')
      return
    }
    const promptArgs = Object.fromEntries(
      Object.entries(parseOptionalJson(match?.[3] ?? '')).map(([key, value]) => [
        key,
        String(value),
      ]),
    )
    const result = await getMcpPrompt(serverName, promptName, promptArgs, visibleWorkspaceRoot)
    printDivider()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    printDivider()
    return
  }

  if (action === 'resource') {
    const match = rest.match(/^(\S+)\s+([\s\S]+)$/)
    const serverName = match?.[1]
    const uri = match?.[2]
    if (!serverName || !uri) {
      fail('Usage: /mcp resource <server> <uri>')
      return
    }
    const result = await readMcpResource(serverName, uri, visibleWorkspaceRoot)
    printDivider()
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    printDivider()
    return
  }

  fail(
    'Usage: /mcp | /mcp add-stdio <name> <command> [args...] | /mcp add-http <name> <url> | /mcp enable <name> | /mcp disable <name> | /mcp remove <name> | /mcp inspect <server> | /mcp set-header <server> <key> <value> | /mcp unset-header <server> <key> | /mcp set-env <server> <key> <value> | /mcp unset-env <server> <key> | /mcp bearer <server> <token> | /mcp tools <server> | /mcp prompts <server> | /mcp resources <server> | /mcp call <server> <tool> [json] | /mcp prompt <server> <prompt> [json] | /mcp resource <server> <uri>',
  )
}

async function handleTasksCommand(): Promise<void> {
  const tasks = await listTasks()
  printTaskList(tasks)
}

async function handleTaskCommand(state: CliState, rawArgs: string): Promise<void> {
  const { action, rest } = parseCommandTarget(rawArgs)

  if (!action) {
    await handleTasksCommand()
    return
  }

  if (action === 'start') {
    if (!rest) {
      fail('Usage: /task start <prompt>')
      return
    }
    const provider = getSelectedProvider(state.settings)
    const model = resolveModel(state.settings, provider)
    const taskSkillMessage = await buildActiveSkillSystemMessage(state.activeSkills, {
      workspaceRoot: state.settings.workspaceRoot,
      cwd: state.cwd,
      accessMode: state.settings.accessMode,
      sessionId: state.sessionId,
    })
    const task = await createTask({
      title: rest,
      prompt: rest,
      workspaceRoot: state.settings.workspaceRoot,
      accessMode: state.settings.accessMode,
      safeWriteMode: state.settings.safeWriteMode,
      providerId: provider.id,
      model,
      cwd: state.cwd,
      baseMessages: taskSkillMessage
        ? [{ role: 'system', content: taskSkillMessage }, ...cloneMessages(state.messages)]
        : cloneMessages(state.messages),
    })
    await recordTaskRunnerPid(task.id, launchTaskRunner(task.id))
    await appendTaskLog(task.id, `[${new Date().toISOString()}] launched from session ${state.sessionId}`)
    await runHookSafely('task-created', state, {
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: task.status,
      prompt: task.prompt,
    })
    ok(`Started task ${task.id}`)
    return
  }

  if (action === 'show') {
    if (!rest) {
      fail('Usage: /task show <id>')
      return
    }
    const task = await getTask(rest)
    if (!task) {
      fail(`Task not found: ${rest}`)
      return
    }
    printTaskDetails(task)
    return
  }

  if (action === 'output' || action === 'result') {
    if (!rest) {
      fail('Usage: /task output <id>')
      return
    }
    const task = await getTask(rest)
    if (!task) {
      fail(`Task not found: ${rest}`)
      return
    }
    printDivider()
    if (task.result?.trim()) {
      process.stdout.write(`${task.result}\n`)
    } else if (task.error?.trim()) {
      process.stdout.write(`${red(task.error)}\n`)
    } else {
      process.stdout.write(`${dim('(no task result yet)')}\n`)
    }
    printDivider()
    return
  }

  if (action === 'logs' || action === 'log') {
    if (!rest) {
      fail('Usage: /task logs <id>')
      return
    }
    const output = await readTaskLog(rest)
    printDivider()
    process.stdout.write(`${output}\n`)
    printDivider()
    return
  }

  if (action === 'stop' || action === 'cancel') {
    if (!rest) {
      fail('Usage: /task stop <id>')
      return
    }
    const task = await stopTask(rest)
    ok(`Stopped task ${task.id}`)
    return
  }

  if (action === 'retry' || action === 'restart') {
    if (!rest) {
      fail('Usage: /task retry <id>')
      return
    }
    const task = await restartTask(rest)
    ok(`Restarted task ${task.id}`)
    return
  }

  if (action === 'update') {
    const match = rest.match(/^(\S+)\s+([\s\S]+)$/)
    const id = match?.[1]
    const prompt = stripWrappingQuotes(match?.[2]?.trim() ?? '')
    if (!id || !prompt) {
      fail('Usage: /task update <id> <prompt>')
      return
    }
    const task = await updateTaskMetadata(id, {
      title: truncate(prompt, MAX_MESSAGE_TITLE_LENGTH),
      prompt,
    })
    ok(`Updated task ${task.id}`)
    return
  }

  fail(
    'Usage: /task start <prompt> | /task show <id> | /task logs <id> | /task output <id> | /task stop <id> | /task retry <id> | /task update <id> <prompt>',
  )
}

async function runCompatibleSlashCommand(
  state: CliState,
  name: string,
  rawArgs: string,
): Promise<boolean> {
  const skillPrompt = await buildLocalSkillPrompt(name, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
    args: rawArgs,
    executeShell: true,
  })

  if (skillPrompt) {
    info(`Running skill ${skillPrompt.skill.name}`)
    if (skillPrompt.skill.context === 'fork' || skillPrompt.skill.agent) {
      const targetAgent = skillPrompt.skill.agent
        ? await getLocalAgent(skillPrompt.skill.agent, state.settings.workspaceRoot, state.cwd)
        : null
      const options = targetAgent
        ? await buildAgentPromptRunOptions(state, targetAgent, [
            `This execution was launched from the skill ${skillPrompt.skill.name}.`,
          ])
        : {
            isolated: true,
            modelOverride: skillPrompt.skill.model,
            extraSystemAddenda: [
              skillPrompt.skill.agent
                ? `Preferred subagent type: ${skillPrompt.skill.agent}. Run in an isolated child execution context.`
                : 'Run in an isolated child execution context.',
            ],
          }
      await runCliSubagentPrompt(
        state,
        targetAgent?.name ?? skillPrompt.skill.agent ?? skillPrompt.skill.name,
        skillPrompt.prompt,
        options,
      )
      return true
    }

    await runPromptInternal(state, skillPrompt.prompt, {
      modelOverride: skillPrompt.skill.model,
    })
    return true
  }

  const localCommandPrompt = await buildLocalCompatCommandPrompt(name, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
    executeShell: true,
  })
  if (localCommandPrompt) {
    info(`Running local command ${localCommandPrompt.command.name}`)
    if (localCommandPrompt.command.context === 'fork' || localCommandPrompt.command.agent) {
      const targetAgent = localCommandPrompt.command.agent
        ? await getLocalAgent(localCommandPrompt.command.agent, state.settings.workspaceRoot, state.cwd)
        : null
      const options = targetAgent
        ? await buildAgentPromptRunOptions(state, targetAgent, [
            `This execution was launched from the local command ${localCommandPrompt.command.name}.`,
          ])
        : {
            isolated: true,
            modelOverride: localCommandPrompt.command.model,
            extraSystemAddenda: [
              localCommandPrompt.command.agent
                ? `Preferred subagent type: ${localCommandPrompt.command.agent}. Run in an isolated child execution context.`
                : 'Run in an isolated child execution context.',
            ],
          }
      await runCliSubagentPrompt(
        state,
        targetAgent?.name ?? localCommandPrompt.command.agent ?? localCommandPrompt.command.name,
        localCommandPrompt.prompt,
        options,
      )
      return true
    }

    await runPromptInternal(state, localCommandPrompt.prompt, {
      modelOverride: localCommandPrompt.command.model,
    })
    return true
  }

  const pluginPrompt = await buildPluginCommandPrompt(name, rawArgs, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
    executeShell: true,
  })
  if (!pluginPrompt) {
    return false
  }

  info(`Running plugin command ${pluginPrompt.command.name}`)
  if (pluginPrompt.command.context === 'fork' || pluginPrompt.command.agent) {
    const targetAgent = pluginPrompt.command.agent
      ? await getLocalAgent(pluginPrompt.command.agent, state.settings.workspaceRoot, state.cwd)
      : null
    const options = targetAgent
      ? await buildAgentPromptRunOptions(state, targetAgent, [
          `This execution was launched from the plugin command ${pluginPrompt.command.name}.`,
        ])
      : {
          isolated: true,
          modelOverride: pluginPrompt.command.model,
          extraSystemAddenda: [
            pluginPrompt.command.agent
              ? `Preferred subagent type: ${pluginPrompt.command.agent}. Run in an isolated child execution context.`
              : 'Run in an isolated child execution context.',
          ],
        }
    await runCliSubagentPrompt(
      state,
      targetAgent?.name ?? pluginPrompt.command.agent ?? pluginPrompt.command.name,
      pluginPrompt.prompt,
      options,
    )
    return true
  }

  await runPromptInternal(state, pluginPrompt.prompt, {
    modelOverride: pluginPrompt.command.model,
  })
  return true
}

function buildMacroPrompt(command: 'review' | 'fix' | 'plan' | 'explain', rawArgs: string): string {
  const details = rawArgs.trim()

  switch (command) {
    case 'review':
      return details
        ? `Review this code or task like a strict code review. Focus on bugs, regressions, risky behavior, and missing tests. Findings first.\n\n${details}`
        : 'Review the current workspace like a strict code review. Inspect relevant files first, then report findings ordered by severity with file references.'
    case 'fix':
      return details
        ? `Inspect the relevant code, fix the issue with the smallest safe change, and summarize the result.\n\n${details}`
        : 'Inspect the current workspace, identify the most important issue you can confidently fix, make the smallest safe change, and summarize the result.'
    case 'plan':
      return details
        ? `Inspect the relevant code and produce a concise implementation plan with risks and next steps.\n\n${details}`
        : 'Inspect the current workspace and produce a concise implementation plan with risks and next steps.'
    case 'explain':
      return details
        ? `Explain the relevant code, architecture, and tradeoffs for this request.\n\n${details}`
        : 'Explain the relevant code, architecture, and tradeoffs in the current workspace.'
  }
}

type PromptRunOptions = {
  quiet?: boolean
  isolated?: boolean
  modelOverride?: string
  extraSystemAddenda?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  maxAgentSteps?: number
  prependedPrompt?: string
  extraSkillNames?: string[]
  source?: UsageSource
}

async function buildAgentPromptRunOptions(
  state: CliState,
  agent: LocalAgentDefinition,
  extraSystemAddenda: string[] = [],
): Promise<PromptRunOptions> {
  const agentMemory = agent.memory
    ? await readAgentMemory(
        agent.name,
        agent.memory,
        state.settings.workspaceRoot,
        state.cwd,
      )
    : null
  const agentSkillMessage = agent.skills?.length
    ? await buildActiveSkillSystemMessage(agent.skills, {
        workspaceRoot: state.settings.workspaceRoot,
        cwd: state.cwd,
        accessMode: state.settings.accessMode,
        sessionId: state.sessionId,
      })
    : null

  return {
    isolated: true,
    modelOverride: agent.model,
    allowedTools: agent.tools,
    disallowedTools: agent.disallowedTools,
    maxAgentSteps: agent.maxTurns,
    prependedPrompt: agent.initialPrompt,
    extraSkillNames: agent.skills,
    extraSystemAddenda: [
      `You are running as the local subagent "${agent.name}".`,
      `Agent description: ${agent.description}`,
      `Agent prompt:\n${agent.prompt}`,
      ...(agent.permissionMode ? [`Requested permission mode: ${agent.permissionMode}`] : []),
      ...(agent.memory ? [`Requested memory scope: ${agent.memory}`] : []),
      ...(agent.isolation ? [`Requested isolation mode: ${agent.isolation}`] : []),
      ...(agentMemory?.content
        ? [`Agent memory (${agentMemory.scope}) from ${agentMemory.path}:\n${agentMemory.content}`]
        : []),
      ...(agentSkillMessage ? [agentSkillMessage] : []),
      ...extraSystemAddenda,
    ],
  }
}

async function runCliSubagentPrompt(
  state: CliState,
  agentName: string,
  prompt: string,
  options: PromptRunOptions,
): Promise<void> {
  await runHookSafely('subagent-start', state, {
    agentName,
    prompt,
  })
  const answer = await runPromptInternal(state, prompt, options)
  await runHookSafely('subagent-stop', state, {
    agentName,
    prompt,
    assistant: answer ?? '',
  })
}

async function runPromptInternal(
  state: CliState,
  rawInput: string,
  options: PromptRunOptions = {},
): Promise<string | null> {
  const runStartedAt = Date.now()
  const provider = getSelectedProvider(state.settings)
  const model = options.modelOverride || resolveModel(state.settings, provider)
  const usageSource = options.source ?? (options.isolated ? 'internal' : 'cli')
  let effectiveRawInput = rawInput
  const compactSystemMessage = buildCompactSystemMessage(state)
  const hookSystemAddenda: string[] = []
  if (!options.isolated) {
    const submitHook = await runHookSafely('user-prompt-submit', state, {
      prompt: rawInput,
    })
    if (submitHook.updatedInput?.trim()) {
      effectiveRawInput = submitHook.updatedInput.trim()
    }
    if (submitHook.additionalContext?.trim()) {
      hookSystemAddenda.push(submitHook.additionalContext.trim())
    }
    if (!submitHook.continue) {
      warn(submitHook.stopReason || 'Prompt blocked by hook')
      return null
    }
    const hookResult = await runHookSafely('before-prompt', state, {
      prompt: effectiveRawInput,
    })
    if (hookResult.updatedInput?.trim()) {
      effectiveRawInput = hookResult.updatedInput.trim()
    }
    if (hookResult.additionalContext?.trim()) {
      hookSystemAddenda.push(hookResult.additionalContext.trim())
    }
    if (!hookResult.continue) {
      warn(hookResult.stopReason || 'Prompt blocked by hook')
      return null
    }
  }

  const attachmentContext = formatAttachmentContext(state.pendingAttachments)
  const baseUserMessage = options.prependedPrompt
    ? `${options.prependedPrompt}\n\n${effectiveRawInput}`
    : effectiveRawInput
  const userMessage = attachmentContext ? `${baseUserMessage}\n\n${attachmentContext}` : baseUserMessage
  const skillNames = [...new Set([...state.activeSkills, ...(options.extraSkillNames ?? [])])]
  const skillSystemMessage = await buildActiveSkillSystemMessage(skillNames, {
    workspaceRoot: state.settings.workspaceRoot,
    cwd: state.cwd,
    accessMode: state.settings.accessMode,
    sessionId: state.sessionId,
  })
  const modeAddenda = buildModeSystemAddenda(state)
  const effectiveAllowedTools = normalizeToolList(options.allowedTools)
  const effectiveDisallowedTools = normalizeToolList([
    ...modeAddenda.disallowedTools,
    ...(options.disallowedTools ?? []),
  ])
  const systemAddenda = [
    ...(state.settings.briefMode
      ? [
          'RoyCode brief mode is enabled. Keep answers concise, high-signal, and compact unless the user explicitly asks for depth.',
        ]
      : []),
    ...buildEffortSystemAddenda(state.settings),
    ...modeAddenda.extraSystemAddenda,
    ...(compactSystemMessage ? [compactSystemMessage] : []),
    ...(skillSystemMessage ? [skillSystemMessage] : []),
    ...hookSystemAddenda,
    ...(options.extraSystemAddenda ?? []).filter(Boolean),
  ]
  const effectiveMessages = options.isolated
    ? ([
        {
          role: 'user',
          content: userMessage,
        },
      ] as AgentMessage[])
    : state.messages

  if (
    !options.isolated &&
    !state.explicitTitle &&
    state.messages.filter(message => message.role === 'user').length === 0
  ) {
    state.sessionTitle = deriveTitleFromPrompt(effectiveRawInput)
  }

  if (!options.isolated) {
    state.messages.push({
      role: 'user',
      content: userMessage,
    })
    state.sessionTouched = true
  }

  const estimatedInputChars =
    systemAddenda.join('\n\n').length + measureMessageChars(effectiveMessages)

  let assistantLineOpen = false

  try {
    const response = await streamAgentChat(
      provider,
      state.settings,
      {
        providerId: provider.id,
        model,
        sessionId: state.sessionId,
        cwd: state.cwd,
        systemAddenda: systemAddenda.length ? systemAddenda : undefined,
        allowedTools: effectiveAllowedTools,
        disallowedTools: effectiveDisallowedTools,
        maxAgentSteps: resolveMaxAgentSteps(state.settings, options.maxAgentSteps),
        messages: effectiveMessages,
      },
      {
        askQuestions: askStructuredQuestions,
        async onEvent(event) {
          switch (event.type) {
            case 'status':
              if (options.quiet) {
                break
              }
              if (assistantLineOpen) {
                process.stdout.write('\n')
                assistantLineOpen = false
              }
              process.stdout.write(`${dim(`[status] ${event.message}`)}\n`)
              break
            case 'text-delta':
              if (options.quiet) {
                break
              }
              if (!assistantLineOpen) {
                process.stdout.write(`${cyan('assistant')} ${dim('>')} `)
                assistantLineOpen = true
              }
              process.stdout.write(event.delta)
              break
            case 'tool-start':
              if (options.quiet) {
                break
              }
              if (assistantLineOpen) {
                process.stdout.write('\n')
                assistantLineOpen = false
              }
              if (!options.isolated) {
                const hookResult = await runHookSafely('before-tool', state, {
                  prompt: rawInput,
                  toolName: event.name,
                  toolInput: event.input,
                })
                if (!hookResult.continue) {
                  warn(hookResult.stopReason || `Hook requested a stop before ${event.name}`)
                }
              }
              process.stdout.write(
                `${magenta('[tool]')} ${event.name} ${dim(truncate(event.input.replace(/\s+/g, ' '), 180))}\n`,
              )
              break
            case 'tool-result':
              if (options.quiet) {
                break
              }
              if (assistantLineOpen) {
                process.stdout.write('\n')
                assistantLineOpen = false
              }
              if (!options.isolated) {
                const hookResult = await runHookSafely('after-tool', state, {
                  prompt: rawInput,
                  toolName: event.name,
                  toolOutput: event.output,
                })
                if (!hookResult.continue) {
                  warn(hookResult.stopReason || `Hook requested a stop after ${event.name}`)
                }
              }
              process.stdout.write(
                `${green('[done]')} ${event.name} ${dim(truncate(event.output.replace(/\s+/g, ' '), 180))}\n`,
              )
              break
            case 'error':
              if (options.quiet) {
                break
              }
              if (assistantLineOpen) {
                process.stdout.write('\n')
                assistantLineOpen = false
              }
              fail(event.error)
              break
            case 'final':
              break
          }
        },
      },
    )

    if (assistantLineOpen) {
      process.stdout.write('\n')
    }

    if (!options.isolated) {
      state.messages.push({
        role: 'assistant',
        content: response.answer,
      })
      state.pendingAttachments = []
      if (state.settings.promptSuggestionEnabled !== false) {
        state.lastSuggestions = buildPromptSuggestions(buildSuggestionContext(state))
      }
      await runHookSafely('after-prompt', state, {
        prompt: effectiveRawInput,
        assistant: response.answer,
      })
      if (state.settings.voiceMode) {
        try {
          await speakText(response.answer)
        } catch (error) {
          warn(`Voice output failed: ${error instanceof Error ? error.message : 'unknown error'}`)
        }
      }
    }

    const durationMs = Date.now() - runStartedAt
    await recordUsageEvent({
      source: usageSource,
      providerId: provider.id,
      model,
      workspaceRoot: state.settings.workspaceRoot,
      sessionId: options.isolated ? undefined : state.sessionId,
      success: true,
      durationMs,
      toolCalls: response.toolEvents.length,
      toolNames: response.toolEvents.map(event => event.name),
      inputChars: estimatedInputChars,
      outputChars: response.answer.length,
    })

    if (
      !options.isolated &&
      state.settings.notificationsEnabled &&
      durationMs >= 10_000
    ) {
      await sendLocalNotification(
        'RoyCode prompt finished',
        truncate(response.answer.replace(/\s+/g, ' '), 180),
      ).catch(() => undefined)
    }

    return response.answer
  } catch (error) {
    if (assistantLineOpen) {
      process.stdout.write('\n')
    }
    const message = error instanceof Error ? error.message : 'Unknown agent error'
    const durationMs = Date.now() - runStartedAt
    await recordUsageEvent({
      source: usageSource,
      providerId: provider.id,
      model,
      workspaceRoot: state.settings.workspaceRoot,
      sessionId: options.isolated ? undefined : state.sessionId,
      success: false,
      durationMs,
      toolCalls: 0,
      toolNames: [],
      inputChars: estimatedInputChars,
      outputChars: 0,
      error: message,
    }).catch(() => undefined)
    if (!options.isolated && state.settings.notificationsEnabled && durationMs >= 10_000) {
      await sendLocalNotification('RoyCode prompt failed', truncate(message, 180)).catch(
        () => undefined,
      )
    }
    if (!options.quiet) {
      fail(message)
    }
    return null
  } finally {
    if (!options.isolated) {
      await saveCurrentSession(state)
    }
  }
}

async function runPrompt(state: CliState, rawInput: string): Promise<void> {
  await runPromptInternal(state, rawInput)
}

async function handleSlashCommand(state: CliState, input: string): Promise<boolean> {
  const command = normalizeCommand(input)
  const slashHook = await runHookSafely('slash-command', state, {
    commandName: command.name,
    commandArgs: command.rawArgs,
  })
  if (!slashHook.continue) {
    warn(slashHook.stopReason || `/${command.name} was blocked by a hook`)
    return true
  }

  if (state.executionMode === 'plan' && isPlanModeWriteCommand(command.name, command.rawArgs)) {
    warn(
      `/${command.name} is blocked in plan mode. Use /plan-mode exit before making changes or running mutating commands.`,
    )
    return true
  }

  switch (command.name) {
    case 'help':
      printHelp()
      return true
    case 'status':
      printStatus(state)
      return true
    case 'usage':
      await handleUsageCommand(command.rawArgs)
      return true
    case 'cost':
      await handleCostCommand(command.rawArgs)
      return true
    case 'stats':
      await handleStatsCommand(state)
      return true
    case 'providers':
      printProviders(state)
      return true
    case 'provider':
      await handleProviderCommand(state, command.rawArgs)
      return true
    case 'models':
      printModels(state)
      return true
    case 'model':
      await handleModelCommand(state, command.rawArgs)
      return true
    case 'theme':
      await handleThemeCommand(state, command.rawArgs)
      return true
    case 'color':
      await handleColorCommand(command.rawArgs)
      return true
    case 'effort':
      await handleEffortCommand(state, command.rawArgs)
      return true
    case 'vim':
      await handleVimCommand(state, command.rawArgs)
      return true
    case 'brief':
      await handleBriefCommand(state, command.rawArgs)
      return true
    case 'suggest':
      await handleSuggestCommand(state, command.rawArgs)
      return true
    case 'voice':
      await handleVoiceCommand(state, command.rawArgs)
      return true
    case 'advisor':
      await handleAdvisorCommand(state, command.rawArgs)
      return true
    case 'notifications':
      await handleNotificationsCommand(state, command.rawArgs)
      return true
    case 'notify':
      await handleNotifyCommand(command.rawArgs)
      return true
    case 'sleep-guard':
    case 'sleepguard':
      await handleSleepGuardCommand(state, command.rawArgs)
      return true
    case 'statusline':
      handleStatuslineCommand(state)
      return true
    case 'keybindings':
      handleKeybindingsCommand()
      return true
    case 'version':
      await handleVersionCommand(state)
      return true
    case 'release-notes':
    case 'releasenotes':
      await handleReleaseNotesCommand(state, command.rawArgs)
      return true
    case 'upgrade':
      await handleUpgradeCommand(state, command.rawArgs)
      return true
    case 'workspace':
      await handleWorkspaceCommand(state, command.rawArgs)
      return true
    case 'access':
      await handleAccessCommand(state, command.rawArgs)
      return true
    case 'permissions':
      await handlePermissionsCommand(state, command.rawArgs)
      return true
    case 'safe-write':
    case 'safewrite':
      await handleSafeWriteCommand(state, command.rawArgs)
      return true
    case 'cwd':
      await handleCwdCommand(state, command.rawArgs)
      return true
    case 'attach':
      await handleAttachCommand(state, command.rawArgs)
      return true
    case 'attachments':
      printAttachments(state.pendingAttachments)
      return true
    case 'files':
      await handleFilesCommand(state, command.rawArgs)
      return true
    case 'read':
      await handleReadCommand(state, command.rawArgs)
      return true
    case 'search':
      await handleSearchCommand(state, command.rawArgs)
      return true
    case 'web-search':
    case 'websearch':
      await handleWebSearchCommand(command.rawArgs)
      return true
    case 'web-fetch':
    case 'webfetch':
      await handleWebFetchCommand(command.rawArgs)
      return true
    case 'run':
      await handleRunCommand(state, command.rawArgs)
      return true
    case 'hooks':
      await handleHooksCommand()
      return true
    case 'hook':
      await handleHookCommand(state, command.rawArgs)
      return true
    case 'skills':
      await handleSkillsCommand(state)
      return true
    case 'agents':
      await handleAgentsCommand(state, '')
      return true
    case 'agent':
      await handleAgentsCommand(state, command.rawArgs)
      return true
    case 'commands':
      await handleCommandsCommand(state, command.rawArgs)
      return true
    case 'skill':
      await handleSkillCommand(state, command.rawArgs)
      return true
    case 'plugins':
      await handlePluginsCommand()
      return true
    case 'plugin':
      await handlePluginCommand(state, command.rawArgs)
      return true
    case 'instructions':
      await handleInstructionsCommand(state)
      return true
    case 'context':
      await handleContextCommand(state)
      return true
    case 'doctor':
      await handleDoctorCommand(state)
      return true
    case 'rules':
      await handleRulesCommand(state, command.rawArgs)
      return true
    case 'memory':
      await handleMemoryCommand(state, command.rawArgs)
      return true
    case 'agent-memory':
    case 'agentmemory':
      await handleAgentMemoryCommand(state, command.rawArgs)
      return true
    case 'config':
      await handleConfigCommand(state, command.rawArgs)
      return true
    case 'output-style':
    case 'outputstyle':
      await handleOutputStyleCommand(state, command.rawArgs)
      return true
    case 'todos':
    case 'todo':
      await handleTodosCommand(state, command.rawArgs)
      return true
    case 'mcp':
      await handleMcpCommand(state, command.rawArgs)
      return true
    case 'cron':
      await handleCronCommand(state, command.rawArgs)
      return true
    case 'worktree':
    case 'worktrees':
      await handleWorktreeCommand(state, command.rawArgs)
      return true
    case 'plan-mode':
    case 'planmode':
      await handlePlanModeCommand(state, command.rawArgs)
      return true
    case 'worktree-mode':
    case 'worktreemode':
      await handleWorktreeModeCommand(state, command.rawArgs)
      return true
    case 'teleport':
      await handleTeleportCommand(state, command.rawArgs)
      return true
    case 'notebook':
      await handleNotebookCommand(state, command.rawArgs)
      return true
    case 'teams':
      await handleTeamsCommand()
      return true
    case 'team':
      await handleTeamCommand(state, command.rawArgs)
      return true
    case 'chrome':
      await handleChromeCommand(command.rawArgs)
      return true
    case 'bridges':
      await handleBridgesCommand()
      return true
    case 'remote-trigger':
    case 'remotetrigger':
      await handleRemoteTriggerCommand(command.rawArgs)
      return true
    case 'bridge':
      await handleBridgeCommand(state, command.rawArgs)
      return true
    case 'marketplace':
      await handleMarketplaceCommand(command.rawArgs)
      return true
    case 'lsp':
      await handleLspCommand(state, command.rawArgs)
      return true
    case 'tasks':
      await handleTasksCommand()
      return true
    case 'task':
      await handleTaskCommand(state, command.rawArgs)
      return true
    case 'pending':
      await handlePendingCommand(command.rawArgs)
      return true
    case 'apply':
      await handleApplyCommand(state, command.rawArgs)
      return true
    case 'reject':
      await handleRejectCommand(state, command.rawArgs)
      return true
    case 'git':
      await handleGitCommand(state, command.rawArgs)
      return true
    case 'sessions':
      await handleSessionsCommand(state)
      return true
    case 'session':
      await handleSessionCommand(state, command.rawArgs)
      return true
    case 'resume':
      await handleResumeCommand(state, command.rawArgs)
      return true
    case 'branch':
      await handleBranchCommand(state, command.rawArgs)
      return true
    case 'summary':
      await handleSummaryCommand(state, command.rawArgs)
      return true
    case 'thinkback':
    case 'insights':
      await handleThinkbackCommand(state)
      return true
    case 'title':
    case 'rename':
      await handleTitleCommand(state, command.rawArgs)
      return true
    case 'delete-session':
      await handleDeleteSessionCommand(state, command.rawArgs)
      return true
    case 'compact':
      await handleCompactCommand(state, command.rawArgs)
      return true
    case 'rewind':
      await handleRewindCommand(state, command.rawArgs)
      return true
    case 'export':
      await handleExportCommand(state, command.rawArgs)
      return true
    case 'settings-sync':
    case 'settingssync':
      await handleSettingsSyncCommand(command.rawArgs)
      return true
    case 'security-review':
    case 'securityreview':
      await handleSecurityReviewCommand(state, command.rawArgs)
      return true
    case 'review':
    case 'fix':
    case 'plan':
    case 'explain':
      await runPrompt(
        state,
        buildMacroPrompt(
          command.name as 'review' | 'fix' | 'plan' | 'explain',
          command.rawArgs,
        ),
      )
      return true
    case 'clear':
      console.clear()
      printBanner(state)
      return true
    case 'new':
      startFreshSession(state)
      ok(`Started fresh session ${state.sessionId}`)
      return true
    case 'exit':
    case 'quit':
      return false
    default:
      if (await runCompatibleSlashCommand(state, command.name, command.rawArgs)) {
        return true
      }
      fail(`Unknown command: /${command.name}`)
      info('Use /help to see the available commands')
      return true
  }
}

async function processInputLine(state: CliState, rawInput: string): Promise<boolean> {
  const trimmed = rawInput.trim()
  if (!trimmed) {
    return true
  }

  try {
    if (trimmed.startsWith('/')) {
      return await handleSlashCommand(state, trimmed)
    }

    await runPrompt(state, trimmed)
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown command error'
    fail(message)
    return true
  }
}

async function captureMultilineInput(
  readline: ReturnType<typeof createInterface>,
): Promise<string | null> {
  info('Multiline mode. Finish with /end or cancel with /cancel.')
  const lines: string[] = []

  while (true) {
    const line = await readline.question(`${dim('... ')} `)
    const trimmed = line.trim()
    if (trimmed === '/end') {
      return lines.join('\n').trimEnd()
    }
    if (trimmed === '/cancel') {
      warn('Discarded multiline input')
      return null
    }
    lines.push(line)
  }
}

async function applyStartupOptions(
  state: CliState,
  options: CliOptions,
  launchDirectory: string,
): Promise<void> {
  let settingsChanged = false

  if (!options.resume && !options.workspace) {
    state.settings = {
      ...state.settings,
      workspaceRoot: launchDirectory,
    }
  }

  if (options.resume && !options.newSession) {
    const session = await loadSessionIntoState(state, options.resume)
    if (!session) {
      warn(`Session not found: ${options.resume}. Starting a fresh session instead.`)
      startFreshSession(state)
    }
  }

  if (options.workspace) {
    state.settings = {
      ...state.settings,
      workspaceRoot: path.resolve(options.workspace),
    }
    state.cwd = '.'
    state.sessionTouched = true
    settingsChanged = true
  }

  if (options.access) {
    state.settings = {
      ...state.settings,
      accessMode: options.access,
    }
    state.sessionTouched = true
    settingsChanged = true
  }

  if (options.dangerouslySkipPermissions) {
    state.settings = {
      ...state.settings,
      accessMode: 'unrestricted',
      safeWriteMode: false,
    }
    state.sessionTouched = true
    settingsChanged = true
  }

  if (typeof options.safeWriteMode === 'boolean') {
    state.settings = {
      ...state.settings,
      safeWriteMode: options.safeWriteMode,
    }
    state.sessionTouched = true
    settingsChanged = true
  }

  if (options.provider) {
    const provider = findProvider(state.settings, options.provider)
    if (!provider) {
      throw new Error(`Provider not found: ${options.provider}`)
    }
    state.settings = {
      ...state.settings,
      selectedProviderId: provider.id,
      selectedModel:
        provider.defaultModel ?? provider.models[0] ?? state.settings.selectedModel,
    }
    state.sessionTouched = true
    settingsChanged = true
  }

  if (options.model) {
    state.settings = {
      ...state.settings,
      selectedModel: options.model,
    }
    state.sessionTouched = true
    settingsChanged = true
  }

  if (options.cwd) {
    state.cwd = options.cwd
    state.sessionTouched = true
  }

  if (options.title) {
    state.sessionTitle = truncate(options.title, MAX_MESSAGE_TITLE_LENGTH)
    state.explicitTitle = true
    state.sessionTouched = true
  }

  if (options.skills.length) {
    const { active, missing } = await resolveActiveSkillNames(
      options.skills,
      state.settings.workspaceRoot,
      state.cwd,
    )
    state.activeSkills = [...new Set([...state.activeSkills, ...active])]
    if (missing.length) {
      warn(`Missing local skills: ${missing.join(', ')}`)
    }
    if (active.length) {
      state.sessionTouched = true
    }
  }

  if (settingsChanged) {
    await writeSettings(state.settings)
  }

  for (const attachment of options.attachments) {
    await handleAttachCommand(state, attachment)
  }

  if (shouldPersistSession(state)) {
    await saveCurrentSession(state)
  }

  await runHookSafely('session-start', state)
  const instructionFiles = await listWorkspaceInstructionFiles(
    state.settings.workspaceRoot,
    state.settings.accessMode,
    state.cwd,
  )
  await runHookSafely('instructions-loaded', state, {
    commandArgs: instructionFiles.map(file => file.path).join(', '),
  })
}

function shouldExitAfterListing(options: CliOptions): boolean {
  return Boolean(
    options.listSessions &&
      !options.prompt &&
      !options.webSearchQuery &&
      !options.webFetchUrl &&
      !options.resume &&
      !options.newSession &&
      !options.workspace &&
      !options.provider &&
      !options.model &&
      !options.access &&
      !options.dangerouslySkipPermissions &&
      typeof options.safeWriteMode !== 'boolean' &&
      !options.cwd &&
      !options.skills.length &&
      !options.attachments.length &&
      !options.title &&
      !options.appendSystemPrompts.length &&
      !options.allowedTools &&
      !options.outputFormat,
  )
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))
  if (options.help) {
    printCliUsage()
    printHelp()
    return
  }

  const settings = await readSettings()
  const state = createFreshState(settings)
  const launchDirectory = path.resolve(
    process.env.ROYCODE_SHELL_CWD || process.cwd(),
  )

  await applyStartupOptions(state, options, launchDirectory)
  await registerCronWorkspace(state.settings.workspaceRoot)
  await startCronScheduler([state.settings.workspaceRoot])
  if (state.settings.sleepGuardMode) {
    await enableSleepGuard().catch(error => {
      warn(
        `Sleep guard could not be enabled automatically: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      )
    })
  }

  try {
    if (options.listSessions) {
      const sessions = await listCliSessions()
      printSessions(sessions, state.sessionId)
      if (shouldExitAfterListing(options)) {
        return
      }
    }

    const interactive = Boolean(
      process.stdin.isTTY &&
        process.stdout.isTTY &&
        !options.prompt &&
        !options.webSearchQuery &&
        !options.webFetchUrl,
    )
    const shouldPrintBanner = interactive || Boolean(options.prompt && !options.printMode)

    if (shouldPrintBanner) {
      printBanner(state)
    }

    if (options.prompt) {
      const answer = await runPromptInternal(state, options.prompt, {
        quiet: options.printMode,
        extraSystemAddenda: options.appendSystemPrompts,
        allowedTools: normalizeToolList(options.allowedTools),
      })
      if (options.printMode && answer != null) {
        if ((options.outputFormat || 'text').toLowerCase() === 'json') {
          process.stdout.write(`${JSON.stringify({ answer }, null, 2)}\n`)
        } else {
          process.stdout.write(`${answer}\n`)
        }
      }
      return
    }

    if (options.webSearchQuery) {
      await handleWebSearchCommand(options.webSearchQuery)
      return
    }

    if (options.webFetchUrl) {
      await handleWebFetchCommand(options.webFetchUrl)
      return
    }

    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: interactive,
      historySize: 500,
    })
    activeReadline = readline

    process.on('SIGINT', () => {
      process.stdout.write(`\n${dim('Use /exit to quit RoyCode CLI.')}\n`)
    })

    try {
      let running = true

      if (interactive) {
        while (running) {
          const rawInput = await readline.question(buildPromptLabel(state))
          const trimmed = rawInput.trim()

          if (trimmed === '/multiline' || trimmed === '/paste') {
            const multilineInput = await captureMultilineInput(readline)
            if (multilineInput && multilineInput.trim()) {
              running = await processInputLine(state, multilineInput)
            }
            continue
          }

          running = await processInputLine(state, rawInput)
        }
      } else {
        for await (const rawInput of readline) {
          running = await processInputLine(state, rawInput)
          if (!running) {
            break
          }
        }
      }
    } finally {
      activeReadline = null
      await runHookSafely('stop', state)
      await saveCurrentSession(state)
      readline.close()
    }
  } finally {
    await stopCronScheduler().catch(() => undefined)
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown CLI error'
  fail(message)
  process.exitCode = 1
})
