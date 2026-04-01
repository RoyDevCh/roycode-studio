import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { AccessMode, FileNode } from './types.js'

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
])

const MAX_TEXT_SIZE = 512 * 1024
const MAX_COMMAND_OUTPUT = 24_000

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, '')
}

export function resolveWorkspacePath(
  workspaceRoot: string,
  requestedPath = '.',
  cwd = '.',
  accessMode: AccessMode = 'workspace',
): string {
  const base = path.isAbsolute(cwd)
    ? cwd
    : path.resolve(workspaceRoot, cwd || '.')
  const resolved = path.isAbsolute(requestedPath)
    ? path.resolve(requestedPath)
    : path.resolve(base, requestedPath)

  if (accessMode === 'unrestricted') {
    return resolved
  }

  const normalizedRoot = path.resolve(workspaceRoot)
  if (
    resolved !== normalizedRoot &&
    !resolved.startsWith(`${normalizedRoot}${path.sep}`)
  ) {
    throw new Error('Path escapes the configured workspace root')
  }
  return resolved
}

export function toWorkspaceRelative(
  workspaceRoot: string,
  absolutePath: string,
  accessMode: AccessMode = 'workspace',
): string {
  if (accessMode === 'unrestricted') {
    return path.resolve(absolutePath).split(path.sep).join('/')
  }

  const relative = path.relative(workspaceRoot, absolutePath)
  return relative === '' ? '.' : relative.split(path.sep).join('/')
}

export async function buildFileTree(
  workspaceRoot: string,
  requestedPath = '.',
  depth = 3,
  accessMode: AccessMode = 'workspace',
): Promise<FileNode[]> {
  const absolutePath = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  return walkDirectory(workspaceRoot, absolutePath, depth, accessMode)
}

async function walkDirectory(
  workspaceRoot: string,
  currentDir: string,
  depth: number,
  accessMode: AccessMode,
): Promise<FileNode[]> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  const visibleEntries = entries
    .filter(entry => !entry.name.startsWith('.DS_Store'))
    .filter(entry => !IGNORED_DIRS.has(entry.name))
    .sort((left, right) => {
      if (left.isDirectory() && !right.isDirectory()) return -1
      if (!left.isDirectory() && right.isDirectory()) return 1
      return left.name.localeCompare(right.name)
    })
    .slice(0, 160)

  const output: FileNode[] = []
  for (const entry of visibleEntries) {
    const fullPath = path.join(currentDir, entry.name)
    const node: FileNode = {
      name: entry.name,
      path: toWorkspaceRelative(workspaceRoot, fullPath, accessMode),
      type: entry.isDirectory() ? 'directory' : 'file',
    }
    if (entry.isDirectory() && depth > 0) {
      node.children = await walkDirectory(workspaceRoot, fullPath, depth - 1, accessMode)
    }
    output.push(node)
  }
  return output
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<string> {
  const fullPath = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  const fileStat = await stat(fullPath)
  if (!fileStat.isFile()) {
    throw new Error('Requested path is not a file')
  }
  if (fileStat.size > MAX_TEXT_SIZE) {
    throw new Error('File is too large to load in the WebUI editor')
  }
  return stripBom(await readFile(fullPath, 'utf8'))
}

export async function readWorkspaceFileIfExists(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<string | null> {
  try {
    return await readWorkspaceFile(workspaceRoot, requestedPath, accessMode)
  } catch (error) {
    if (error instanceof Error && error.message.includes('not a file')) {
      throw error
    }
    return null
  }
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  requestedPath: string,
  content: string,
  accessMode: AccessMode = 'workspace',
): Promise<void> {
  const fullPath = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  await writeFile(fullPath, content, 'utf8')
}

export async function replaceInWorkspaceFile(
  workspaceRoot: string,
  requestedPath: string,
  searchValue: string,
  replaceValue: string,
  replaceAll = false,
  accessMode: AccessMode = 'workspace',
): Promise<string> {
  const original = await readWorkspaceFile(workspaceRoot, requestedPath, accessMode)
  if (!original.includes(searchValue)) {
    throw new Error('Search text was not found in the target file')
  }
  const updated = replaceAll
    ? original.split(searchValue).join(replaceValue)
    : original.replace(searchValue, replaceValue)
  await writeWorkspaceFile(workspaceRoot, requestedPath, updated, accessMode)
  return `Updated ${requestedPath}`
}

export async function searchWorkspace(
  workspaceRoot: string,
  query: string,
  requestedPath = '.',
  maxResults = 20,
  accessMode: AccessMode = 'workspace',
): Promise<Array<{ path: string; line: number; preview: string }>> {
  if (!query.trim()) {
    return []
  }
  const targetRoot = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  const results: Array<{ path: string; line: number; preview: string }> = []
  await walkForSearch(
    workspaceRoot,
    targetRoot,
    query.toLowerCase(),
    results,
    maxResults,
    accessMode,
  )
  return results
}

async function walkForSearch(
  workspaceRoot: string,
  currentDir: string,
  query: string,
  results: Array<{ path: string; line: number; preview: string }>,
  maxResults: number,
  accessMode: AccessMode,
): Promise<void> {
  if (results.length >= maxResults) {
    return
  }
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (results.length >= maxResults) {
      return
    }
    if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      continue
    }
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await walkForSearch(workspaceRoot, fullPath, query, results, maxResults, accessMode)
      continue
    }
    try {
      const fileStat = await stat(fullPath)
      if (fileStat.size > 128 * 1024) {
        continue
      }
      const content = stripBom(await readFile(fullPath, 'utf8'))
      const lines = content.split(/\r?\n/)
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (line.toLowerCase().includes(query)) {
          results.push({
            path: toWorkspaceRelative(workspaceRoot, fullPath, accessMode),
            line: index + 1,
            preview: line.trim().slice(0, 220),
          })
        }
        if (results.length >= maxResults) {
          return
        }
      }
    } catch {
      continue
    }
  }
}

function trimCommandOutput(text: string): string {
  if (text.length <= MAX_COMMAND_OUTPUT) {
    return text
  }
  return `${text.slice(0, MAX_COMMAND_OUTPUT)}\n...[truncated]`
}

function isDangerousCommand(command: string): boolean {
  const normalized = command.toLowerCase()
  return [
    /\brm\s+-rf\s+\/\b/,
    /\bshutdown\b/,
    /\breboot\b/,
    /\bformat\b/,
    /\bmkfs\b/,
    /\bdiskpart\b/,
    /\bdel\s+\/[sq]/,
  ].some(pattern => pattern.test(normalized))
}

export async function runWorkspaceCommand(
  workspaceRoot: string,
  command: string,
  cwd = '.',
  timeoutMs = 20_000,
  accessMode: AccessMode = 'workspace',
  envOverrides?: Record<string, string>,
  shellOverride?: 'bash' | 'powershell',
  stdinData?: string,
): Promise<string> {
  if (isDangerousCommand(command)) {
    throw new Error('Blocked a potentially destructive command')
  }

  const resolvedCwd = resolveWorkspacePath(workspaceRoot, '.', cwd, accessMode)
  const shell =
    shellOverride === 'bash'
      ? process.platform === 'win32'
        ? 'bash.exe'
        : 'bash'
      : shellOverride === 'powershell'
        ? 'powershell.exe'
        : process.platform === 'win32'
          ? process.env.ROYCODE_DEFAULT_SHELL?.toLowerCase() === 'bash'
            ? 'bash.exe'
            : 'powershell.exe'
          : process.env.SHELL || 'bash'
  const shellArgs =
    (shellOverride === 'powershell' ||
      (!shellOverride &&
        process.platform === 'win32' &&
        process.env.ROYCODE_DEFAULT_SHELL?.toLowerCase() !== 'bash'))
      ? ['-NoProfile', '-Command', command]
      : ['-lc', command]

  return new Promise((resolve, reject) => {
    const child = spawn(shell, shellArgs, {
      cwd: resolvedCwd,
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Command timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    if (stdinData != null) {
      child.stdin.write(stdinData)
    }
    child.stdin.end()

    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })

    child.on('close', code => {
      clearTimeout(timer)
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n')
      const finalOutput = trimCommandOutput(combined || '(no output)')
      if (code === 0) {
        resolve(finalOutput)
        return
      }
      reject(new Error(`Command exited with code ${code}\n${finalOutput}`))
    })
  })
}
