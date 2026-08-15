import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCompatCommandDocument,
  buildShortNameFromPath,
  expandCompatToolNames,
  type CompatCommandDocument,
} from './commandCompat.js'

const USER_COMPAT_AGENTS_DIR = process.env.ROYCODE_CLAUDE_AGENTS_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_AGENTS_DIR)
  : path.join(os.homedir(), '.claude', 'agents')

export type LocalAgentSource = 'workspace' | 'user'

export type LocalAgentDefinition = {
  name: string
  description: string
  summary: string
  prompt: string
  filePath: string
  baseDir?: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  model?: string
  effort?: string
  permissionMode?: string
  maxTurns?: number
  background?: boolean
  initialPrompt?: string
  memory?: 'user' | 'project' | 'local'
  isolation?: 'worktree' | 'remote'
  source: LocalAgentSource
}

function coerceString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map(item => coerceString(item))
      .filter((item): item is string => Boolean(item))
    return items.length ? items : undefined
  }
  const raw = coerceString(value)
  if (!raw) {
    return undefined
  }
  const items = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
  return items.length ? items : undefined
}

function coerceBoolean(value: unknown): boolean | undefined {
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
  return undefined
}

function coercePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed
    }
  }
  return undefined
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function walkMarkdownFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []

  async function visit(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (
        entry.name === '.git' ||
        entry.name === 'node_modules' ||
        entry.name === 'dist' ||
        entry.name === '.next'
      ) {
        continue
      }
      const fullPath = path.join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
        continue
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(fullPath)
      }
    }
  }

  if (await pathExists(rootPath)) {
    await visit(rootPath)
  }

  return files
}

function buildAgentRoots(
  workspaceRoot?: string,
  cwd = '.',
): Array<{ rootPath: string; source: LocalAgentSource }> {
  const roots: Array<{ rootPath: string; source: LocalAgentSource }> = [
    {
      rootPath: USER_COMPAT_AGENTS_DIR,
      source: 'user',
    },
  ]

  if (workspaceRoot) {
    const normalizedRoot = path.resolve(workspaceRoot)
    const resolvedCwd = path.isAbsolute(cwd)
      ? path.resolve(cwd)
      : path.resolve(normalizedRoot, cwd || '.')

    if (
      resolvedCwd === normalizedRoot ||
      resolvedCwd.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      let current = resolvedCwd
      while (true) {
        roots.push({
          rootPath: path.join(current, '.claude', 'agents'),
          source: 'workspace',
        })
        if (current === normalizedRoot) {
          break
        }
        const parent = path.dirname(current)
        if (parent === current) {
          break
        }
        current = parent
      }
    } else {
      roots.push({
        rootPath: path.join(normalizedRoot, '.claude', 'agents'),
        source: 'workspace',
      })
    }
  }

  return roots
}

function toLocalAgent(
  document: CompatCommandDocument,
  source: LocalAgentSource,
): LocalAgentDefinition {
  const frontmatter = document.frontmatter
  const memoryRaw = coerceString(frontmatter.memory)
  const isolationRaw = coerceString(frontmatter.isolation)

  return {
    name: document.name,
    description: document.description,
    summary: document.summary,
    prompt: document.content,
    filePath: document.filePath,
    baseDir: document.baseDir,
    tools: coerceStringArray(frontmatter.tools)
      ? expandCompatToolNames(coerceStringArray(frontmatter.tools)!)
      : undefined,
    disallowedTools: coerceStringArray(frontmatter.disallowedTools)
      ? expandCompatToolNames(coerceStringArray(frontmatter.disallowedTools)!)
      : undefined,
    skills: coerceStringArray(frontmatter.skills),
    model: document.model,
    effort: document.effort,
    permissionMode: coerceString(frontmatter.permissionMode),
    maxTurns: coercePositiveInt(frontmatter.maxTurns),
    background: coerceBoolean(frontmatter.background),
    initialPrompt: coerceString(frontmatter.initialPrompt),
    memory:
      memoryRaw === 'user' || memoryRaw === 'project' || memoryRaw === 'local'
        ? memoryRaw
        : undefined,
    isolation:
      isolationRaw === 'worktree' || isolationRaw === 'remote'
        ? isolationRaw
        : undefined,
    source,
  }
}

async function loadAgentDocumentsFromRoot(
  rootPath: string,
  source: LocalAgentSource,
): Promise<LocalAgentDefinition[]> {
  const files = await walkMarkdownFiles(rootPath)
  const documents = new Map<string, LocalAgentDefinition>()

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8')
    const relative = path.relative(rootPath, filePath)
    const name = buildShortNameFromPath(relative, 'command')
    const document = buildCompatCommandDocument({
      name,
      shortName: name,
      kind: 'command',
      filePath,
      baseDir: path.dirname(filePath),
      rawMarkdown: raw,
      defaultUserInvocable: true,
    })
    documents.set(document.name.toLowerCase(), toLocalAgent(document, source))
  }

  return [...documents.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function loadLocalAgentDocuments(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalAgentDefinition[]> {
  await mkdir(USER_COMPAT_AGENTS_DIR, { recursive: true })
  const deduped = new Map<string, LocalAgentDefinition>()

  for (const root of buildAgentRoots(workspaceRoot, cwd)) {
    const documents = await loadAgentDocumentsFromRoot(root.rootPath, root.source)
    for (const document of documents) {
      const key = document.name.toLowerCase()
      if (!deduped.has(key)) {
        deduped.set(key, document)
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listLocalAgents(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalAgentDefinition[]> {
  return loadLocalAgentDocuments(workspaceRoot, cwd)
}

export async function getLocalAgent(
  reference: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalAgentDefinition | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const agents = await loadLocalAgentDocuments(workspaceRoot, cwd)
  return (
    agents.find(agent => agent.name.toLowerCase() === normalized) ??
    agents.find(agent => agent.name.toLowerCase().startsWith(normalized)) ??
    agents.find(agent => agent.name.toLowerCase().includes(normalized)) ??
    null
  )
}
