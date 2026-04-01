import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  readWorkspaceFileIfExists,
  resolveWorkspacePath,
  toWorkspaceRelative,
  writeWorkspaceFile,
} from './filesystem.js'
import type {
  AccessMode,
  PendingChange,
  PendingChangeSource,
  WorkspaceFilePayload,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const PENDING_CHANGES_PATH = path.join(DATA_DIR, 'pending-changes.json')

type PendingChangeMap = Record<string, PendingChange>

async function ensurePendingStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(PENDING_CHANGES_PATH, 'utf8')
  } catch {
    await writeFile(PENDING_CHANGES_PATH, JSON.stringify({}, null, 2), 'utf8')
  }
}

async function readPendingMap(): Promise<PendingChangeMap> {
  await ensurePendingStore()
  const raw = await readFile(PENDING_CHANGES_PATH, 'utf8')
  return JSON.parse(raw) as PendingChangeMap
}

async function writePendingMap(data: PendingChangeMap): Promise<void> {
  await ensurePendingStore()
  await writeFile(PENDING_CHANGES_PATH, JSON.stringify(data, null, 2), 'utf8')
}

function normalizePath(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): string {
  const absolutePath = resolveWorkspacePath(workspaceRoot, requestedPath, '.', accessMode)
  return toWorkspaceRelative(workspaceRoot, absolutePath, accessMode)
}

export async function listPendingChanges(): Promise<PendingChange[]> {
  const pending = await readPendingMap()
  return Object.values(pending).sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )
}

export async function getPendingChange(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<PendingChange | null> {
  const pending = await readPendingMap()
  const key = normalizePath(workspaceRoot, requestedPath, accessMode)
  return pending[key] ?? null
}

export async function getWorkspaceFilePayload(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<WorkspaceFilePayload> {
  const normalizedPath = normalizePath(workspaceRoot, requestedPath, accessMode)
  const diskContent =
    (await readWorkspaceFileIfExists(workspaceRoot, normalizedPath, accessMode)) ?? ''
  const pendingChange = await getPendingChange(workspaceRoot, normalizedPath, accessMode)
  return {
    path: normalizedPath,
    diskContent,
    content: pendingChange?.content ?? diskContent,
    pendingChange,
  }
}

export async function stagePendingChange(args: {
  workspaceRoot: string
  path: string
  content: string
  source: PendingChangeSource
  accessMode?: AccessMode
}): Promise<PendingChange> {
  const accessMode = args.accessMode ?? 'workspace'
  const normalizedPath = normalizePath(args.workspaceRoot, args.path, accessMode)
  const pending = await readPendingMap()
  const existing = pending[normalizedPath]
  const originalContent =
    existing?.originalContent ??
    ((await readWorkspaceFileIfExists(
      args.workspaceRoot,
      normalizedPath,
      accessMode,
    )) ?? '')

  const nextPending: PendingChange = {
    path: normalizedPath,
    originalContent,
    content: args.content,
    updatedAt: new Date().toISOString(),
    source: args.source,
  }

  if (nextPending.content === nextPending.originalContent) {
    delete pending[normalizedPath]
    await writePendingMap(pending)
    return nextPending
  }

  pending[normalizedPath] = nextPending
  await writePendingMap(pending)
  return nextPending
}

export async function applyPendingChange(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<PendingChange> {
  const normalizedPath = normalizePath(workspaceRoot, requestedPath, accessMode)
  const pending = await readPendingMap()
  const change = pending[normalizedPath]
  if (!change) {
    throw new Error('Pending change not found')
  }
  await writeWorkspaceFile(workspaceRoot, normalizedPath, change.content, accessMode)
  delete pending[normalizedPath]
  await writePendingMap(pending)
  return change
}

export async function commitWorkspaceChange(args: {
  workspaceRoot: string
  path: string
  content: string
  accessMode?: AccessMode
}): Promise<void> {
  const accessMode = args.accessMode ?? 'workspace'
  const normalizedPath = normalizePath(args.workspaceRoot, args.path, accessMode)
  await writeWorkspaceFile(args.workspaceRoot, normalizedPath, args.content, accessMode)
  const pending = await readPendingMap()
  delete pending[normalizedPath]
  await writePendingMap(pending)
}

export async function applyWorkspaceBatchChanges(args: {
  workspaceRoot: string
  files: Array<{
    path: string
    content: string
    source: PendingChangeSource
  }>
  safeWriteMode: boolean
  accessMode?: AccessMode
}): Promise<Array<{ path: string; mode: 'pending' | 'written' }>> {
  const accessMode = args.accessMode ?? 'workspace'
  const results: Array<{ path: string; mode: 'pending' | 'written' }> = []

  for (const file of args.files) {
    if (args.safeWriteMode) {
      await stagePendingChange({
        workspaceRoot: args.workspaceRoot,
        path: file.path,
        content: file.content,
        source: file.source,
        accessMode,
      })
      results.push({
        path: normalizePath(args.workspaceRoot, file.path, accessMode),
        mode: 'pending',
      })
      continue
    }

    await commitWorkspaceChange({
      workspaceRoot: args.workspaceRoot,
      path: file.path,
      content: file.content,
      accessMode,
    })
    results.push({
      path: normalizePath(args.workspaceRoot, file.path, accessMode),
      mode: 'written',
    })
  }

  return results
}

export async function discardPendingChange(
  workspaceRoot: string,
  requestedPath: string,
  accessMode: AccessMode = 'workspace',
): Promise<void> {
  const normalizedPath = normalizePath(workspaceRoot, requestedPath, accessMode)
  const pending = await readPendingMap()
  delete pending[normalizedPath]
  await writePendingMap(pending)
}

export async function applyAllPendingChanges(
  workspaceRoot: string,
  accessMode: AccessMode = 'workspace',
): Promise<PendingChange[]> {
  const changes = await listPendingChanges()
  for (const change of changes) {
    await writeWorkspaceFile(workspaceRoot, change.path, change.content, accessMode)
  }
  await writePendingMap({})
  return changes
}
