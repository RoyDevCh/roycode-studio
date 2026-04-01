import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  buildCompatCommandDocument,
  buildCompatPrompt,
  buildShortNameFromPath,
  type CompatCommandDocument,
} from './commandCompat.js'
import type { AccessMode } from './types.js'

const USER_CLAUDE_COMMANDS_DIR = process.env.ROYCODE_CLAUDE_COMMANDS_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_COMMANDS_DIR)
  : path.join(os.homedir(), '.claude', 'commands')

export type LocalCommandSource = 'workspace-claude' | 'user-claude'

export type LocalCommandDocument = {
  name: string
  shortName: string
  filePath: string
  baseDir?: string
  summary: string
  content: string
  argumentHint?: string
  argumentNames?: string[]
  whenToUse?: string
  version?: string
  model?: string
  effort?: string
  userInvocable?: boolean
  context?: 'inline' | 'fork'
  agent?: string
  shell?: 'bash' | 'powershell'
  allowedTools?: string[]
  source: LocalCommandSource
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

function toLocalCommand(
  document: CompatCommandDocument,
  source: LocalCommandSource,
): LocalCommandDocument {
  return {
    name: document.name,
    shortName: document.shortName,
    filePath: document.filePath,
    baseDir: document.baseDir,
    summary: document.summary,
    content: document.content,
    argumentHint: document.argumentHint,
    argumentNames: document.argumentNames,
    whenToUse: document.whenToUse,
    version: document.version,
    model: document.model,
    effort: document.effort,
    userInvocable: document.userInvocable,
    context: document.context,
    agent: document.agent,
    shell: document.shell,
    allowedTools: document.allowedTools,
    source,
  }
}

function buildCommandRoots(
  workspaceRoot?: string,
  cwd = '.',
): Array<{ rootPath: string; source: LocalCommandSource }> {
  const roots: Array<{ rootPath: string; source: LocalCommandSource }> = []
  roots.push({
    rootPath: USER_CLAUDE_COMMANDS_DIR,
    source: 'user-claude',
  })
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
          rootPath: path.join(current, '.claude', 'commands'),
          source: 'workspace-claude',
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
        rootPath: path.join(normalizedRoot, '.claude', 'commands'),
        source: 'workspace-claude',
      })
    }
  }
  return roots
}

async function loadCommandDocumentsFromRoot(
  rootPath: string,
  source: LocalCommandSource,
): Promise<LocalCommandDocument[]> {
  const files = await walkMarkdownFiles(rootPath)
  const documents = new Map<string, LocalCommandDocument>()

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8')
    const relative = path.relative(rootPath, filePath)
    const shortName = buildShortNameFromPath(relative, 'command')
    const document = buildCompatCommandDocument({
      name: shortName,
      shortName,
      kind: 'command',
      filePath,
      baseDir: path.dirname(filePath),
      rawMarkdown: raw,
      defaultUserInvocable: true,
    })
    documents.set(document.name.toLowerCase(), toLocalCommand(document, source))
  }

  return [...documents.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function loadLocalCommandDocuments(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalCommandDocument[]> {
  const deduped = new Map<string, LocalCommandDocument>()

  for (const root of buildCommandRoots(workspaceRoot, cwd)) {
    if (root.source === 'user-claude') {
      await mkdir(root.rootPath, { recursive: true })
    }
    const documents = await loadCommandDocumentsFromRoot(root.rootPath, root.source)
    for (const document of documents) {
      const key = document.name.toLowerCase()
      if (!deduped.has(key)) {
        deduped.set(key, document)
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listLocalCompatCommands(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalCommandDocument[]> {
  return loadLocalCommandDocuments(workspaceRoot, cwd)
}

export async function getLocalCompatCommand(
  reference: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalCommandDocument | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const documents = await loadLocalCommandDocuments(workspaceRoot, cwd)
  return (
    documents.find(item => item.name.toLowerCase() === normalized) ??
    documents.find(item => item.shortName.toLowerCase() === normalized) ??
    documents.find(item => item.name.toLowerCase().startsWith(normalized)) ??
    documents.find(item => item.name.toLowerCase().includes(normalized)) ??
    null
  )
}

export async function buildLocalCompatCommandPrompt(
  reference: string,
  options: {
    workspaceRoot: string
    cwd: string
    accessMode: AccessMode
    sessionId: string
    args?: string
    executeShell?: boolean
  },
): Promise<{ command: LocalCommandDocument; prompt: string } | null> {
  const command = await getLocalCompatCommand(reference, options.workspaceRoot, options.cwd)
  if (!command) {
    return null
  }

  const prompt = await buildCompatPrompt(
    {
      name: command.name,
      shortName: command.shortName,
      kind: 'command',
      filePath: command.filePath,
      baseDir: command.baseDir,
      description: command.summary,
      summary: command.summary,
      content: command.content,
      rawContent: command.content,
      frontmatter: {},
      allowedTools: command.allowedTools ?? [],
      argumentHint: command.argumentHint,
      argumentNames: command.argumentNames ?? [],
      whenToUse: command.whenToUse,
      version: command.version,
      model: command.model,
      effort: command.effort,
      userInvocable: command.userInvocable ?? true,
      context: command.context ?? 'inline',
      agent: command.agent,
      shell: command.shell,
    },
    {
      workspaceRoot: options.workspaceRoot,
      cwd: options.cwd,
      accessMode: options.accessMode,
      sessionId: options.sessionId,
      args: options.args ?? '',
      executeShell: options.executeShell ?? true,
    },
  )

  return {
    command,
    prompt,
  }
}
