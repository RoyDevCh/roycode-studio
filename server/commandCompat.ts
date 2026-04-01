import path from 'node:path'
import YAML from 'yaml'
import { runWorkspaceCommand } from './filesystem.js'
import type { AccessMode } from './types.js'

export type CompatCommandKind = 'skill' | 'command'
export type CompatExecutionContext = 'inline' | 'fork'
export type CompatShell = 'bash' | 'powershell'

export type CompatCommandDocument = {
  name: string
  shortName: string
  pluginName?: string
  kind: CompatCommandKind
  filePath: string
  baseDir?: string
  description: string
  summary: string
  content: string
  rawContent: string
  frontmatter: Record<string, unknown>
  allowedTools: string[]
  argumentHint?: string
  argumentNames: string[]
  whenToUse?: string
  version?: string
  model?: string
  effort?: string
  userInvocable: boolean
  context: CompatExecutionContext
  agent?: string
  shell?: CompatShell
}

export type CompatPromptBuildInput = {
  workspaceRoot: string
  cwd: string
  accessMode: AccessMode
  sessionId: string
  args?: string
  executeShell?: boolean
}

const BLOCK_PATTERN = /```!\s*\n?([\s\S]*?)\n?```/g
const INLINE_PATTERN = /(?<=^|\s)!`([^`]+)`/gm
const COMPAT_TOOL_NAME_MAP: Record<string, string[]> = {
  bash: ['run_command'],
  powershell: ['run_command'],
  repl: ['run_command'],
  read: ['read_file'],
  fileread: ['read_file'],
  write: ['write_file'],
  filewrite: ['write_file'],
  edit: ['replace_in_file', 'write_file'],
  fileedit: ['replace_in_file', 'write_file'],
  grep: ['search_files'],
  glob: ['list_files'],
  websearch: ['web_search'],
  webfetch: ['web_fetch'],
  agent: ['run_subagent'],
  skill: ['skill'],
  taskcreate: ['create_task'],
  taskget: ['get_task'],
  tasklist: ['list_tasks'],
  taskoutput: ['get_task'],
  taskupdate: ['get_task'],
  taskstop: ['get_task'],
  toolsearch: ['tool_search'],
  rules: ['list_rules', 'read_rule'],
  outputstyle: ['list_output_styles'],
  config: ['get_config', 'set_config'],
  configtool: ['get_config', 'set_config'],
  todowrite: ['todo_write'],
  todoread: ['read_todos'],
  todo: ['read_todos', 'todo_write'],
  askuserquestion: ['ask_user_question'],
  mcp: [
    'list_mcp_servers',
    'list_mcp_tools',
    'call_mcp_tool',
    'list_mcp_prompts',
    'get_mcp_prompt',
    'list_mcp_resources',
    'read_mcp_resource',
  ],
  listmcpresources: ['list_mcp_resources'],
  readmcpresource: ['read_mcp_resource'],
}

export function parseMarkdownFrontmatter(markdown: string): {
  frontmatter: Record<string, unknown>
  body: string
} {
  const normalized = markdown.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/)
  if (!match) {
    return {
      frontmatter: {},
      body: normalized,
    }
  }

  const rawFrontmatter = match[1] ?? ''
  const body = match[2] ?? ''

  try {
    const parsed = YAML.parse(rawFrontmatter)
    return {
      frontmatter:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
      body,
    }
  } catch {
    return {
      frontmatter: {},
      body,
    }
  }
}

export function extractSummary(content: string): string {
  const lines = content
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('```'))
  return lines[0]?.slice(0, 160) || 'No summary available.'
}

function coerceString(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => coerceString(item))
      .filter((item): item is string => Boolean(item))
  }
  const one = coerceString(value)
  if (!one) {
    return []
  }
  if (one.startsWith('[') && one.endsWith(']')) {
    return one
      .slice(1, -1)
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }
  return one
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeCompatToolKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function expandCompatToolNames(values: string[]): string[] {
  const expanded = new Set<string>()

  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) {
      continue
    }
    const mapped = COMPAT_TOOL_NAME_MAP[normalizeCompatToolKey(trimmed)]
    if (mapped?.length) {
      for (const item of mapped) {
        expanded.add(item)
      }
      continue
    }
    expanded.add(trimmed)
  }

  return [...expanded]
}

function parseBooleanValue(value: unknown, fallback: boolean): boolean {
  if (value == null) {
    return fallback
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', 'yes', 'on', '1'].includes(normalized)) {
      return true
    }
    if (['false', 'no', 'off', '0'].includes(normalized)) {
      return false
    }
  }
  return fallback
}

export function parseArgumentNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => coerceString(item))
      .filter((item): item is string => Boolean(item))
      .filter(item => !/^\d+$/.test(item))
  }
  const raw = coerceString(value)
  if (!raw) {
    return []
  }
  return raw
    .split(/\s+/)
    .map(item => item.trim())
    .filter(Boolean)
    .filter(item => !/^\d+$/.test(item))
}

function parseCommandArguments(args: string): string[] {
  if (!args.trim()) {
    return []
  }

  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let escaping = false

  for (const char of args) {
    if (escaping) {
      current += char
      escaping = false
      continue
    }
    if (char === '\\') {
      escaping = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = null
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }

  if (current) {
    tokens.push(current)
  }

  return tokens
}

export function substituteArguments(
  content: string,
  args: string,
  argumentNames: string[],
): string {
  const parsedArgs = parseCommandArguments(args)
  const originalContent = content

  for (let index = 0; index < argumentNames.length; index += 1) {
    const name = argumentNames[index]
    if (!name) {
      continue
    }
    content = content.replace(
      new RegExp(`\\$${name}(?![\\[\\w])`, 'g'),
      parsedArgs[index] ?? '',
    )
  }

  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexText: string) => {
    const index = Number(indexText)
    return parsedArgs[index] ?? ''
  })

  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexText: string) => {
    const index = Number(indexText)
    return parsedArgs[index] ?? ''
  })

  content = content.replaceAll('$ARGUMENTS', args)

  if (content === originalContent && args.trim()) {
    content = `${content}\n\nARGUMENTS: ${args}`
  }

  return content
}

export function buildCompatCommandDocument(input: {
  name: string
  shortName: string
  kind: CompatCommandKind
  filePath: string
  baseDir?: string
  rawMarkdown: string
  pluginName?: string
  defaultUserInvocable?: boolean
}): CompatCommandDocument {
  const parsed = parseMarkdownFrontmatter(input.rawMarkdown)
  const description =
    coerceString(parsed.frontmatter.description) || extractSummary(parsed.body)
  const summary = extractSummary(parsed.body)
  const shellValue = coerceString(parsed.frontmatter.shell)?.toLowerCase()
  const shell =
    shellValue === 'bash' || shellValue === 'powershell'
      ? (shellValue as CompatShell)
      : undefined
  const contextValue = coerceString(parsed.frontmatter.context)?.toLowerCase()
  const context = contextValue === 'fork' ? 'fork' : 'inline'

  return {
    name: input.name,
    shortName: input.shortName,
    pluginName: input.pluginName,
    kind: input.kind,
    filePath: input.filePath,
    baseDir: input.baseDir,
    description,
    summary,
    content: parsed.body.trim(),
    rawContent: input.rawMarkdown,
    frontmatter: parsed.frontmatter,
    allowedTools: expandCompatToolNames(coerceStringArray(parsed.frontmatter['allowed-tools'])),
    argumentHint: coerceString(parsed.frontmatter['argument-hint']),
    argumentNames: parseArgumentNames(parsed.frontmatter.arguments),
    whenToUse: coerceString(parsed.frontmatter.when_to_use),
    version: coerceString(parsed.frontmatter.version),
    model: coerceString(parsed.frontmatter.model),
    effort: coerceString(parsed.frontmatter.effort),
    userInvocable: parseBooleanValue(
      parsed.frontmatter['user-invocable'],
      input.defaultUserInvocable ?? true,
    ),
    context,
    agent: coerceString(parsed.frontmatter.agent),
    shell,
  }
}

async function executeEmbeddedShellCommands(
  text: string,
  options: CompatPromptBuildInput,
  shell?: CompatShell,
): Promise<string> {
  let result = text
  const blockMatches = [...text.matchAll(BLOCK_PATTERN)]
  const inlineMatches = text.includes('!`') ? [...text.matchAll(INLINE_PATTERN)] : []

  const matches = [...blockMatches, ...inlineMatches]
  for (const match of matches) {
    const command = match[1]?.trim()
    if (!command) {
      continue
    }
    const output = await runWorkspaceCommand(
      options.workspaceRoot,
      command,
      options.cwd,
      20_000,
      options.accessMode,
      undefined,
      shell,
    )
    result = result.replace(match[0], () => output)
  }

  return result
}

export async function buildCompatPrompt(
  document: CompatCommandDocument,
  options: CompatPromptBuildInput,
): Promise<string> {
  let prompt = document.content

  if (document.baseDir) {
    prompt = `Base directory for this skill: ${document.baseDir}\n\n${prompt}`
  }

  prompt = substituteArguments(prompt, options.args ?? '', document.argumentNames)

  if (document.baseDir) {
    const skillDir =
      process.platform === 'win32'
        ? document.baseDir.replace(/\\/g, '/')
        : document.baseDir
    prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir)
  }

  prompt = prompt.replace(/\$\{CLAUDE_SESSION_ID\}/g, options.sessionId)

  if (options.executeShell) {
    prompt = await executeEmbeddedShellCommands(prompt, options, document.shell)
  }

  return prompt
}

export function buildShortNameFromPath(
  relativePath: string,
  kind: CompatCommandKind,
): string {
  const normalized = relativePath.split(path.sep).join('/').replace(/^\/+/, '')
  if (kind === 'skill' && path.basename(normalized).toLowerCase() === 'skill.md') {
    const parentDir = path.dirname(normalized)
    return parentDir === '.' ? 'skill' : parentDir.split('/').join(':')
  }
  return normalized.replace(/\.md$/i, '').split('/').join(':')
}
