import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { resolveWorkspacePath, toWorkspaceRelative } from './filesystem.js'
import type { AccessMode } from './types.js'

const DOC_IGNORES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.turbo'])
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const MAX_DOC_SIZE = 256 * 1024

export type MagicDocEntry = {
  path: string
  title: string
  snippet: string
}

async function walkDocs(
  workspaceRoot: string,
  currentDir: string,
  accessMode: AccessMode,
  output: string[],
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true })
  for (const entry of entries) {
    if (DOC_IGNORES.has(entry.name)) {
      continue
    }
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      await walkDocs(workspaceRoot, fullPath, accessMode, output)
      continue
    }
    if (!DOC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue
    }
    output.push(toWorkspaceRelative(workspaceRoot, fullPath, accessMode))
  }
}

function normalizeDocText(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

function inferTitle(content: string, filePath: string): string {
  const heading = content
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith('# '))
  return heading ? heading.replace(/^#\s+/, '') : path.basename(filePath)
}

function makeSnippet(content: string, query?: string): string {
  const lines = normalizeDocText(content)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (!lines.length) {
    return ''
  }

  if (query) {
    const lowerQuery = query.toLowerCase()
    const matched = lines.find(line => line.toLowerCase().includes(lowerQuery))
    if (matched) {
      return matched.slice(0, 220)
    }
  }

  return lines.slice(0, 3).join(' ').slice(0, 220)
}

export async function listMagicDocs(
  workspaceRoot: string,
  accessMode: AccessMode = 'workspace',
): Promise<string[]> {
  const root = resolveWorkspacePath(workspaceRoot, '.', '.', accessMode)
  const output: string[] = []
  await walkDocs(workspaceRoot, root, accessMode, output)
  return output.sort((left, right) => left.localeCompare(right))
}

export async function readMagicDoc(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<MagicDocEntry & { content: string }> {
  const fullPath = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  const fileStat = await stat(fullPath)
  if (!fileStat.isFile()) {
    throw new Error('Requested path is not a documentation file')
  }
  if (fileStat.size > MAX_DOC_SIZE) {
    throw new Error('Documentation file is too large to inspect directly')
  }
  const content = normalizeDocText(await readFile(fullPath, 'utf8'))
  const relativePath = toWorkspaceRelative(workspaceRoot, fullPath, accessMode)
  return {
    path: relativePath,
    title: inferTitle(content, relativePath),
    snippet: makeSnippet(content),
    content,
  }
}

export async function searchMagicDocs(
  workspaceRoot: string,
  query: string,
  accessMode: AccessMode = 'workspace',
  limit = 8,
): Promise<MagicDocEntry[]> {
  const docs = await listMagicDocs(workspaceRoot, accessMode)
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  const scored: Array<MagicDocEntry & { score: number }> = []
  for (const docPath of docs) {
    try {
      const entry = await readMagicDoc(workspaceRoot, docPath, accessMode)
      const haystack = `${docPath}\n${entry.title}\n${entry.content}`.toLowerCase()
      if (!haystack.includes(normalizedQuery)) {
        continue
      }
      const pathScore = docPath.toLowerCase().includes(normalizedQuery) ? 5 : 0
      const titleScore = entry.title.toLowerCase().includes(normalizedQuery) ? 4 : 0
      const frequency = haystack.split(normalizedQuery).length - 1
      scored.push({
        path: entry.path,
        title: entry.title,
        snippet: makeSnippet(entry.content, query),
        score: pathScore + titleScore + frequency,
      })
    } catch {
      continue
    }
  }

  return scored
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, limit)
    .map(({ score: _score, ...rest }) => rest)
}
