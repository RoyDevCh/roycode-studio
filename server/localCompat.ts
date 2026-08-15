import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseMarkdownFrontmatter } from './commandCompat.js'

export type LocalCompatSource = 'workspace' | 'user'

export type LocalRuleDocument = {
  name: string
  filePath: string
  baseDir?: string
  description: string
  content: string
  paths?: string[]
  source: LocalCompatSource
}

export type LocalOutputStyleDocument = {
  name: string
  filePath: string
  description: string
  prompt: string
  keepCodingInstructions?: boolean
  source: LocalCompatSource
}

export type AgentMemoryScope = 'user' | 'project' | 'local'

export type AgentMemoryDocument = {
  agentName: string
  scope: AgentMemoryScope
  path: string
  content: string
}

const USER_COMPAT_RULES_DIR = process.env.ROYCODE_CLAUDE_RULES_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_RULES_DIR)
  : path.join(os.homedir(), '.claude', 'rules')

const USER_COMPAT_OUTPUT_STYLES_DIR = process.env.ROYCODE_CLAUDE_OUTPUT_STYLES_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_OUTPUT_STYLES_DIR)
  : path.join(os.homedir(), '.claude', 'output-styles')

const USER_COMPAT_AGENT_MEMORY_DIR = process.env.ROYCODE_CLAUDE_AGENT_MEMORY_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_AGENT_MEMORY_DIR)
  : path.join(os.homedir(), '.claude', 'agent-memory')

function normalizeText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return undefined
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map(item => normalizeText(item))
      .filter((item): item is string => Boolean(item))
    return items.length ? items : undefined
  }
  const one = normalizeText(value)
  if (!one) {
    return undefined
  }
  return one
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeBoolean(value: unknown): boolean | undefined {
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

function normalizeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return slug || 'item'
}

function buildShortNameFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, '').split(path.sep).join(':')
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
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(fullPath)
      }
    }
  }

  if (await pathExists(rootPath)) {
    await visit(rootPath)
  }

  return files
}

function buildProjectRoots(
  workspaceRoot: string | undefined,
  cwd: string,
  subdir: string,
): string[] {
  if (!workspaceRoot) {
    return []
  }

  const normalizedRoot = path.resolve(workspaceRoot)
  const resolvedCwd = path.isAbsolute(cwd)
    ? path.resolve(cwd)
    : path.resolve(normalizedRoot, cwd || '.')

  const roots: string[] = []
  if (
    resolvedCwd === normalizedRoot ||
    resolvedCwd.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    let current = resolvedCwd
    while (true) {
      roots.push(path.join(current, '.claude', subdir))
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
    roots.push(path.join(normalizedRoot, '.claude', subdir))
  }

  return roots
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DOUBLE_STAR::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DOUBLE_STAR::/g, '.*')
    .replace(/\?/g, '[^/]')
  return new RegExp(`^${escaped}$`, 'i')
}

function pathMatchesPatterns(targetPath: string, patterns: string[]): boolean {
  if (!patterns.length) {
    return true
  }

  const normalizedTarget = targetPath.split(path.sep).join('/')
  return patterns.some(pattern => {
    const normalizedPattern = pattern.replace(/\\/g, '/').trim().replace(/^\.\/+/, '')
    if (!normalizedPattern) {
      return false
    }
    const direct = globToRegExp(normalizedPattern)
    const nested = globToRegExp(
      normalizedPattern.startsWith('**/') ? normalizedPattern : `**/${normalizedPattern}`,
    )
    return direct.test(normalizedTarget) || nested.test(normalizedTarget)
  })
}

async function loadRuleDocumentsFromRoot(
  rootPath: string,
  source: LocalCompatSource,
): Promise<LocalRuleDocument[]> {
  const files = await walkMarkdownFiles(rootPath)
  const deduped = new Map<string, LocalRuleDocument>()

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseMarkdownFrontmatter(raw)
    const relative = path.relative(rootPath, filePath)
    const name = buildShortNameFromRelativePath(relative)
    deduped.set(name.toLowerCase(), {
      name,
      filePath,
      baseDir: path.dirname(filePath),
      description:
        normalizeText(frontmatter.description) ||
        body.split(/\r?\n/).map(line => line.trim()).find(Boolean) ||
        'Rule document',
      content: body.trim(),
      paths: normalizeStringArray(frontmatter.paths),
      source,
    })
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listLocalRules(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalRuleDocument[]> {
  const deduped = new Map<string, LocalRuleDocument>()
  const roots = [
    { rootPath: USER_COMPAT_RULES_DIR, source: 'user' as const },
    ...buildProjectRoots(workspaceRoot, cwd, 'rules').map(rootPath => ({
      rootPath,
      source: 'workspace' as const,
    })),
  ]

  for (const root of roots) {
    if (root.source === 'user') {
      await mkdir(root.rootPath, { recursive: true })
    }
    const documents = await loadRuleDocumentsFromRoot(root.rootPath, root.source)
    for (const document of documents) {
      const key = document.name.toLowerCase()
      if (!deduped.has(key)) {
        deduped.set(key, document)
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getApplicableRules(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalRuleDocument[]> {
  const rules = await listLocalRules(workspaceRoot, cwd)
  if (!workspaceRoot) {
    return rules.filter(rule => !rule.paths?.length)
  }
  const normalizedRoot = path.resolve(workspaceRoot)
  const resolvedCwd = path.isAbsolute(cwd)
    ? path.resolve(cwd)
    : path.resolve(normalizedRoot, cwd || '.')
  const relativeCwd = path.relative(normalizedRoot, resolvedCwd).split(path.sep).join('/')
  const currentPath = relativeCwd === '' ? '.' : relativeCwd
  return rules.filter(rule => !rule.paths?.length || pathMatchesPatterns(currentPath, rule.paths))
}

async function loadOutputStylesFromRoot(
  rootPath: string,
  source: LocalCompatSource,
): Promise<LocalOutputStyleDocument[]> {
  const files = await walkMarkdownFiles(rootPath)
  const documents = new Map<string, LocalOutputStyleDocument>()

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8')
    const { frontmatter, body } = parseMarkdownFrontmatter(raw)
    const relative = path.relative(rootPath, filePath)
    const fallbackName = buildShortNameFromRelativePath(relative)
    const name = normalizeText(frontmatter.name) || fallbackName
    const description =
      normalizeText(frontmatter.description) ||
      body.split(/\r?\n/).map(line => line.trim()).find(Boolean) ||
      'Custom output style'

    documents.set(name.toLowerCase(), {
      name,
      filePath,
      description,
      prompt: body.trim(),
      keepCodingInstructions: normalizeBoolean(frontmatter['keep-coding-instructions']),
      source,
    })
  }

  return [...documents.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listLocalOutputStyles(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalOutputStyleDocument[]> {
  const deduped = new Map<string, LocalOutputStyleDocument>()
  const roots = [
    ...buildProjectRoots(workspaceRoot, cwd, 'output-styles').map(rootPath => ({
      rootPath,
      source: 'workspace' as const,
    })),
    { rootPath: USER_COMPAT_OUTPUT_STYLES_DIR, source: 'user' as const },
  ]

  for (const root of roots) {
    if (root.source === 'user') {
      await mkdir(root.rootPath, { recursive: true })
    }
    const documents = await loadOutputStylesFromRoot(root.rootPath, root.source)
    for (const document of documents) {
      deduped.set(document.name.toLowerCase(), document)
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getLocalOutputStyle(
  name: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalOutputStyleDocument | null> {
  const normalized = name.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const styles = await listLocalOutputStyles(workspaceRoot, cwd)
  return (
    styles.find(style => style.name.toLowerCase() === normalized) ??
    styles.find(style => style.name.toLowerCase().startsWith(normalized)) ??
    styles.find(style => style.name.toLowerCase().includes(normalized)) ??
    null
  )
}

function sanitizeAgentNameForPath(agentName: string): string {
  return normalizeName(agentName).replace(/:/g, '-')
}

function resolveCurrentDirectory(workspaceRoot?: string, cwd = '.'): string {
  if (!workspaceRoot) {
    return path.resolve(cwd || '.')
  }
  return path.isAbsolute(cwd)
    ? path.resolve(cwd)
    : path.resolve(path.resolve(workspaceRoot), cwd || '.')
}

function getAgentMemoryPathForScope(
  agentName: string,
  scope: AgentMemoryScope,
  workspaceRoot?: string,
  cwd = '.',
): string {
  const normalizedAgent = sanitizeAgentNameForPath(agentName)
  const currentDir = resolveCurrentDirectory(workspaceRoot, cwd)
  switch (scope) {
    case 'user':
      return path.join(USER_COMPAT_AGENT_MEMORY_DIR, normalizedAgent, 'MEMORY.md')
    case 'project':
      return path.join(currentDir, '.claude', 'agent-memory', normalizedAgent, 'MEMORY.md')
    case 'local':
      return path.join(currentDir, '.claude', 'agent-memory-local', normalizedAgent, 'MEMORY.md')
  }
}

export async function readAgentMemory(
  agentName: string,
  scope: AgentMemoryScope,
  workspaceRoot?: string,
  cwd = '.',
): Promise<AgentMemoryDocument> {
  const targetPath = getAgentMemoryPathForScope(agentName, scope, workspaceRoot, cwd)
  await mkdir(path.dirname(targetPath), { recursive: true })
  let content = ''
  try {
    content = (await readFile(targetPath, 'utf8')).replace(/^\uFEFF/, '').trim()
  } catch {
    content = ''
  }
  return {
    agentName: normalizeName(agentName),
    scope,
    path: targetPath,
    content,
  }
}

export async function writeAgentMemory(
  agentName: string,
  scope: AgentMemoryScope,
  content: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<AgentMemoryDocument> {
  const targetPath = getAgentMemoryPathForScope(agentName, scope, workspaceRoot, cwd)
  await mkdir(path.dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content, 'utf8')
  return readAgentMemory(agentName, scope, workspaceRoot, cwd)
}

export async function appendAgentMemory(
  agentName: string,
  scope: AgentMemoryScope,
  content: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<AgentMemoryDocument> {
  const current = await readAgentMemory(agentName, scope, workspaceRoot, cwd)
  const next = current.content.trim()
    ? `${current.content.trimEnd()}\n\n${content.trim()}\n`
    : `${content.trim()}\n`
  return writeAgentMemory(agentName, scope, next, workspaceRoot, cwd)
}

