import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AccessMode } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const WORKSPACE_MEMORY_DIR = path.join(DATA_DIR, 'workspace-memory')
const MAX_SECTION_CHARS = 8_000

export type WorkspaceContextFile = {
  path: string
  label: string
  kind: 'instructions' | 'memory'
  content: string
}

const WORKSPACE_MEMORY_TEMPLATE = `# Workspace Memory

Record stable information that should carry across sessions in this workspace.

## Current State

## Important Files

## Commands

## Risks

## Notes
`

function truncateSection(value: string, maxChars = MAX_SECTION_CHARS): string {
  const trimmed = value.trim()
  return trimmed.length > maxChars
    ? `${trimmed.slice(0, maxChars)}\n...[truncated]`
    : trimmed
}

function getWorkspaceMemoryKey(workspaceRoot: string): string {
  return createHash('sha1').update(path.resolve(workspaceRoot)).digest('hex')
}

export function getWorkspaceMemoryPath(workspaceRoot: string): string {
  return path.join(WORKSPACE_MEMORY_DIR, `${getWorkspaceMemoryKey(workspaceRoot)}.md`)
}

async function ensureWorkspaceMemoryFile(workspaceRoot: string): Promise<string> {
  await mkdir(WORKSPACE_MEMORY_DIR, { recursive: true })
  const targetPath = getWorkspaceMemoryPath(workspaceRoot)
  try {
    await readFile(targetPath, 'utf8')
  } catch {
    await writeFile(targetPath, WORKSPACE_MEMORY_TEMPLATE, 'utf8')
  }
  return targetPath
}

export async function readWorkspaceMemory(workspaceRoot: string): Promise<WorkspaceContextFile> {
  const targetPath = await ensureWorkspaceMemoryFile(workspaceRoot)
  const raw = await readFile(targetPath, 'utf8')
  return {
    path: targetPath,
    label: 'Workspace Memory',
    kind: 'memory',
    content: truncateSection(raw.replace(/^\uFEFF/, '')),
  }
}

export async function writeWorkspaceMemory(
  workspaceRoot: string,
  content: string,
): Promise<WorkspaceContextFile> {
  const targetPath = await ensureWorkspaceMemoryFile(workspaceRoot)
  await writeFile(targetPath, content, 'utf8')
  return readWorkspaceMemory(workspaceRoot)
}

export async function appendWorkspaceMemory(
  workspaceRoot: string,
  content: string,
): Promise<WorkspaceContextFile> {
  const current = await readWorkspaceMemory(workspaceRoot)
  const next = `${current.content.trimEnd()}\n\n${content.trim()}\n`
  return writeWorkspaceMemory(workspaceRoot, next)
}

async function readContextFile(targetPath: string): Promise<string | null> {
  try {
    const raw = await readFile(targetPath, 'utf8')
    const trimmed = raw.replace(/^\uFEFF/, '').trim()
    return trimmed ? truncateSection(trimmed) : null
  } catch {
    return null
  }
}

function buildNestedClaudeInstructionCandidates(workspaceRoot: string): Array<{
  relativePath: string
  label: string
}> {
  const root = path.resolve(workspaceRoot)
  const resolvedCwd = process.env.ROYCODE_SHELL_CWD
    ? path.resolve(process.env.ROYCODE_SHELL_CWD)
    : root

  const directories: string[] = []
  if (resolvedCwd === root || resolvedCwd.startsWith(`${root}${path.sep}`)) {
    let current = resolvedCwd
    while (true) {
      const relativeDir = path.relative(root, current)
      directories.push(relativeDir === '' ? '.' : relativeDir)
      if (current === root) {
        break
      }
      const parent = path.dirname(current)
      if (parent === current) {
        break
      }
      current = parent
    }
  } else {
    directories.push('.')
  }

  const candidates: Array<{ relativePath: string; label: string }> = []
  for (const relativeDir of directories) {
    const prefix = relativeDir === '.' ? '' : `${relativeDir}${path.sep}`
    for (const name of ['CLAUDE.md', 'INSTRUCTIONS.md']) {
      const relativePath = path.join(prefix, '.claude', name)
      candidates.push({
        relativePath,
        label: relativePath.split(path.sep).join('/'),
      })
    }
  }
  return candidates
}

export async function listWorkspaceInstructionFiles(
  workspaceRoot: string,
  _accessMode: AccessMode = 'workspace',
  cwd = '.',
): Promise<WorkspaceContextFile[]> {
  const root = path.resolve(workspaceRoot)
  const previousShellCwd = process.env.ROYCODE_SHELL_CWD
  process.env.ROYCODE_SHELL_CWD = path.isAbsolute(cwd)
    ? path.resolve(cwd)
    : path.resolve(root, cwd || '.')
  const candidates = [
    { relativePath: 'CLAUDE.md', label: 'CLAUDE.md' },
    { relativePath: 'ROYCODE.md', label: 'ROYCODE.md' },
    { relativePath: 'AGENTS.md', label: 'AGENTS.md' },
    { relativePath: '.roycode/CLAUDE.md', label: '.roycode/CLAUDE.md' },
    { relativePath: '.roycode/INSTRUCTIONS.md', label: '.roycode/INSTRUCTIONS.md' },
    {
      relativePath: '.github/copilot-instructions.md',
      label: '.github/copilot-instructions.md',
    },
    ...buildNestedClaudeInstructionCandidates(root),
  ]

  const output: WorkspaceContextFile[] = []
  const seen = new Set<string>()
  try {
    for (const candidate of candidates) {
      const absolutePath = path.join(root, candidate.relativePath)
      if (seen.has(absolutePath)) {
        continue
      }
      seen.add(absolutePath)
      const content = await readContextFile(absolutePath)
      if (!content) {
        continue
      }
      output.push({
        path: absolutePath,
        label: candidate.label,
        kind: 'instructions',
        content,
      })
    }
    return output
  } finally {
    if (previousShellCwd === undefined) {
      delete process.env.ROYCODE_SHELL_CWD
    } else {
      process.env.ROYCODE_SHELL_CWD = previousShellCwd
    }
  }
}

export async function loadWorkspaceContext(
  workspaceRoot: string,
  accessMode: AccessMode = 'workspace',
  cwd = '.',
): Promise<{
  instructionFiles: WorkspaceContextFile[]
  workspaceMemory: WorkspaceContextFile
}> {
  const [instructionFiles, workspaceMemory] = await Promise.all([
    listWorkspaceInstructionFiles(workspaceRoot, accessMode, cwd),
    readWorkspaceMemory(workspaceRoot),
  ])

  return {
    instructionFiles,
    workspaceMemory,
  }
}
