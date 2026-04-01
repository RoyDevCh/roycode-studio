import { readWorkspaceFile, resolveWorkspacePath } from './filesystem.js'
import { commitWorkspaceChange, stagePendingChange } from './pendingChanges.js'
import type { AccessMode } from './types.js'

type NotebookCell = {
  cell_type?: string
  id?: string
  source?: string[] | string
  metadata?: Record<string, unknown>
  outputs?: unknown[]
  execution_count?: number | null
}

type NotebookDocument = {
  cells?: NotebookCell[]
  metadata?: Record<string, unknown>
  nbformat?: number
  nbformat_minor?: number
}

export type NotebookCellSummary = {
  index: number
  id?: string
  type: string
  lines: number
  preview: string
}

function stringifySource(source: NotebookCell['source']): string {
  if (Array.isArray(source)) {
    return source.join('')
  }
  return typeof source === 'string' ? source : ''
}

function splitSource(text: string): string[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines.map((line, index) => (index < lines.length - 1 ? `${line}\n` : line))
}

function parseNotebook(text: string): NotebookDocument {
  const parsed = JSON.parse(text) as NotebookDocument
  return {
    cells: Array.isArray(parsed.cells) ? parsed.cells : [],
    metadata: parsed.metadata ?? {},
    nbformat: parsed.nbformat ?? 4,
    nbformat_minor: parsed.nbformat_minor ?? 5,
  }
}

async function loadNotebook(
  workspaceRoot: string,
  notebookPath: string,
  accessMode: AccessMode,
): Promise<{ notebook: NotebookDocument; content: string; path: string }> {
  const content = await readWorkspaceFile(workspaceRoot, notebookPath, accessMode)
  return {
    notebook: parseNotebook(content),
    content,
    path: resolveWorkspacePath(workspaceRoot, notebookPath, '.', accessMode),
  }
}

function serializeNotebook(document: NotebookDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

function getCell(document: NotebookDocument, reference: string | number): { index: number; cell: NotebookCell } {
  const cells = document.cells ?? []
  const numeric =
    typeof reference === 'number'
      ? reference
      : Number.isFinite(Number(reference))
        ? Number(reference)
        : null

  if (numeric !== null && numeric >= 0 && numeric < cells.length) {
    return {
      index: numeric,
      cell: cells[numeric]!,
    }
  }

  const normalized = String(reference).trim().toLowerCase()
  const matchIndex = cells.findIndex(cell => String(cell.id ?? '').toLowerCase() === normalized)
  if (matchIndex >= 0) {
    return {
      index: matchIndex,
      cell: cells[matchIndex]!,
    }
  }

  throw new Error(`Notebook cell not found: ${reference}`)
}

async function persistNotebook(args: {
  workspaceRoot: string
  notebookPath: string
  document: NotebookDocument
  accessMode: AccessMode
  safeWriteMode: boolean
  source: 'manual' | 'agent'
}): Promise<{ mode: 'written' | 'staged'; content: string }> {
  const content = serializeNotebook(args.document)
  if (args.safeWriteMode) {
    await stagePendingChange({
      workspaceRoot: args.workspaceRoot,
      path: args.notebookPath,
      content,
      source: args.source,
      accessMode: args.accessMode,
    })
    return { mode: 'staged', content }
  }

  await commitWorkspaceChange({
    workspaceRoot: args.workspaceRoot,
    path: args.notebookPath,
    content,
    accessMode: args.accessMode,
  })
  return { mode: 'written', content }
}

export async function listNotebookCells(
  workspaceRoot: string,
  notebookPath: string,
  accessMode: AccessMode,
): Promise<NotebookCellSummary[]> {
  const { notebook } = await loadNotebook(workspaceRoot, notebookPath, accessMode)
  return (notebook.cells ?? []).map((cell, index) => {
    const source = stringifySource(cell.source)
    const trimmed = source.trim()
    return {
      index,
      id: cell.id,
      type: cell.cell_type || 'unknown',
      lines: source ? source.replace(/\r\n/g, '\n').split('\n').length : 0,
      preview: trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed,
    }
  })
}

export async function readNotebookCell(
  workspaceRoot: string,
  notebookPath: string,
  reference: string | number,
  accessMode: AccessMode,
): Promise<{ index: number; id?: string; type: string; source: string }> {
  const { notebook } = await loadNotebook(workspaceRoot, notebookPath, accessMode)
  const { index, cell } = getCell(notebook, reference)
  return {
    index,
    id: cell.id,
    type: cell.cell_type || 'unknown',
    source: stringifySource(cell.source),
  }
}

export async function setNotebookCellSource(args: {
  workspaceRoot: string
  notebookPath: string
  reference: string | number
  newSource: string
  accessMode: AccessMode
  safeWriteMode: boolean
  source: 'manual' | 'agent'
}): Promise<{ index: number; mode: 'written' | 'staged' }> {
  const { notebook } = await loadNotebook(args.workspaceRoot, args.notebookPath, args.accessMode)
  const { index, cell } = getCell(notebook, args.reference)
  cell.source = splitSource(args.newSource)
  const persisted = await persistNotebook({
    workspaceRoot: args.workspaceRoot,
    notebookPath: args.notebookPath,
    document: notebook,
    accessMode: args.accessMode,
    safeWriteMode: args.safeWriteMode,
    source: args.source,
  })
  return {
    index,
    mode: persisted.mode,
  }
}

export async function addNotebookCell(args: {
  workspaceRoot: string
  notebookPath: string
  type: 'code' | 'markdown' | 'raw'
  content: string
  index?: number
  accessMode: AccessMode
  safeWriteMode: boolean
  source: 'manual' | 'agent'
}): Promise<{ index: number; mode: 'written' | 'staged' }> {
  const { notebook } = await loadNotebook(args.workspaceRoot, args.notebookPath, args.accessMode)
  const cells = notebook.cells ?? []
  const nextIndex =
    typeof args.index === 'number' && args.index >= 0 && args.index <= cells.length
      ? args.index
      : cells.length

  const nextCell: NotebookCell = {
    cell_type: args.type,
    id: `cell-${Date.now().toString(36)}`,
    source: splitSource(args.content),
    metadata: {},
  }

  if (args.type === 'code') {
    nextCell.outputs = []
    nextCell.execution_count = null
  }

  cells.splice(nextIndex, 0, nextCell)
  notebook.cells = cells
  const persisted = await persistNotebook({
    workspaceRoot: args.workspaceRoot,
    notebookPath: args.notebookPath,
    document: notebook,
    accessMode: args.accessMode,
    safeWriteMode: args.safeWriteMode,
    source: args.source,
  })

  return {
    index: nextIndex,
    mode: persisted.mode,
  }
}

export async function deleteNotebookCell(args: {
  workspaceRoot: string
  notebookPath: string
  reference: string | number
  accessMode: AccessMode
  safeWriteMode: boolean
  source: 'manual' | 'agent'
}): Promise<{ index: number; mode: 'written' | 'staged' }> {
  const { notebook } = await loadNotebook(args.workspaceRoot, args.notebookPath, args.accessMode)
  const { index } = getCell(notebook, args.reference)
  notebook.cells?.splice(index, 1)
  const persisted = await persistNotebook({
    workspaceRoot: args.workspaceRoot,
    notebookPath: args.notebookPath,
    document: notebook,
    accessMode: args.accessMode,
    safeWriteMode: args.safeWriteMode,
    source: args.source,
  })
  return {
    index,
    mode: persisted.mode,
  }
}
