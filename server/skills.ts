import { cp, copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildCompatCommandDocument,
  buildCompatPrompt,
  buildShortNameFromPath,
  type CompatCommandDocument,
} from './commandCompat.js'
import { BUNDLED_SKILL_SEEDS } from './bundledSkillSeeds.js'
import { getPluginSkill, listPluginSkills } from './pluginRuntime.js'
import type { AccessMode } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const SKILLS_DIR = process.env.ROYCODE_SKILLS_DIR
  ? path.resolve(process.env.ROYCODE_SKILLS_DIR)
  : path.join(DATA_DIR, 'skills')
const USER_CLAUDE_SKILLS_DIR = process.env.ROYCODE_CLAUDE_SKILLS_DIR
  ? path.resolve(process.env.ROYCODE_CLAUDE_SKILLS_DIR)
  : path.join(os.homedir(), '.claude', 'skills')

export type LocalSkillSource =
  | 'workspace-claude'
  | 'user-claude'
  | 'roycode-data'
  | 'plugin'

export type LocalSkill = {
  name: string
  filePath: string
  summary: string
  source: LocalSkillSource
  userInvocable?: boolean
}

export type LocalSkillDocument = LocalSkill & {
  content: string
  baseDir?: string
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
}

async function ensureSkillsDir(): Promise<void> {
  await mkdir(SKILLS_DIR, { recursive: true })
}

async function ensureBundledSkillSeeds(): Promise<void> {
  await ensureSkillsDir()
  for (const [fileName, content] of Object.entries(BUNDLED_SKILL_SEEDS)) {
    const targetPath = path.join(SKILLS_DIR, fileName)
    if (await pathExists(targetPath)) {
      continue
    }
    await writeFile(targetPath, content, 'utf8')
  }
}

function normalizeSkillName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Skill name must contain letters or numbers')
  }
  return slug
}

function toLocalSkill(document: CompatCommandDocument): LocalSkillDocument {
  return {
    name: document.name,
    filePath: document.filePath,
    summary: document.summary,
    source: 'roycode-data',
    content: document.content,
    baseDir: document.baseDir,
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
  }
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

function buildSkillRoots(
  workspaceRoot?: string,
  cwd = '.',
): Array<{ rootPath: string; source: Exclude<LocalSkillSource, 'plugin'> }> {
  const roots: Array<{ rootPath: string; source: Exclude<LocalSkillSource, 'plugin'> }> = []

  roots.push({
    rootPath: USER_CLAUDE_SKILLS_DIR,
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
          rootPath: path.join(current, '.claude', 'skills'),
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
        rootPath: path.join(normalizedRoot, '.claude', 'skills'),
        source: 'workspace-claude',
      })
    }
  }

  roots.push({
    rootPath: SKILLS_DIR,
    source: 'roycode-data',
  })

  return roots
}

async function loadSkillDocumentsFromRoot(
  rootPath: string,
  source: Exclude<LocalSkillSource, 'plugin'>,
): Promise<LocalSkillDocument[]> {
  const files = await walkMarkdownFiles(rootPath)
  const documents = new Map<string, LocalSkillDocument>()

  for (const filePath of files) {
    const raw = await readFile(filePath, 'utf8')
    const relative = path.relative(rootPath, filePath)
    const shortName = buildShortNameFromPath(relative, 'skill')
    const document = buildCompatCommandDocument({
      name: shortName,
      shortName,
      kind: 'skill',
      filePath,
      baseDir: path.dirname(filePath),
      rawMarkdown: raw,
      defaultUserInvocable: true,
    })
    documents.set(
      document.name.toLowerCase(),
      {
        ...toLocalSkill(document),
        source,
      },
    )
  }

  return [...documents.values()].sort((left, right) => left.name.localeCompare(right.name))
}

async function loadLocalSkillDocuments(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalSkillDocument[]> {
  await ensureBundledSkillSeeds()
  const deduped = new Map<string, LocalSkillDocument>()

  for (const root of buildSkillRoots(workspaceRoot, cwd)) {
    const documents = await loadSkillDocumentsFromRoot(root.rootPath, root.source)
    for (const document of documents) {
      const key = document.name.toLowerCase()
      if (!deduped.has(key)) {
        deduped.set(key, document)
      }
    }
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listLocalSkills(
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalSkill[]> {
  const localSkills = await loadLocalSkillDocuments(workspaceRoot, cwd)
  const pluginSkills = (await listPluginSkills()).map(skill => ({
    ...skill,
    source: 'plugin' as const,
  }))
  return [...localSkills, ...pluginSkills].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getLocalSkill(
  name: string,
  workspaceRoot?: string,
  cwd = '.',
): Promise<LocalSkillDocument | null> {
  if (name.includes(':')) {
    const pluginSkill = await getPluginSkill(name)
    if (pluginSkill) {
      return {
        name: pluginSkill.name,
        filePath: pluginSkill.filePath,
        summary: pluginSkill.summary,
        source: 'plugin',
        content: pluginSkill.content,
        baseDir: pluginSkill.baseDir,
        argumentHint: pluginSkill.argumentHint,
        argumentNames: pluginSkill.argumentNames,
        whenToUse: pluginSkill.whenToUse,
        version: pluginSkill.version,
        model: pluginSkill.model,
        effort: pluginSkill.effort,
        userInvocable: pluginSkill.userInvocable,
        context: pluginSkill.context,
        agent: pluginSkill.agent,
        shell: pluginSkill.shell,
        allowedTools: pluginSkill.allowedTools,
      }
    }
  }

  const normalized = normalizeSkillName(name)
  const documents = await loadLocalSkillDocuments(workspaceRoot, cwd)
  const document =
    documents.find(item => item.name === normalized) ??
    documents.find(item => item.name.startsWith(normalized)) ??
    documents.find(item => item.name.includes(normalized)) ??
    null
  return document
}

async function copySkillDirectory(sourceDir: string, targetDir: string): Promise<void> {
  await rm(targetDir, { recursive: true, force: true })
  await cp(sourceDir, targetDir, {
    recursive: true,
    force: true,
  })
}

async function expandArchive(sourcePath: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roycode-skill-'))
  const destination = path.join(tempRoot, 'expanded')

  await mkdir(destination, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    const command = [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${sourcePath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`,
    ]
    const child = spawn('powershell.exe', command, {
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Expand-Archive exited with code ${code}`))
      }
    })
  })

  const entries = await readdir(destination, { withFileTypes: true })
  if (entries.length === 1 && entries[0]?.isDirectory()) {
    return path.join(destination, entries[0].name)
  }
  return destination
}

export async function importLocalSkill(
  sourcePath: string,
  explicitName?: string,
): Promise<LocalSkill> {
  await ensureSkillsDir()
  const absoluteSource = path.resolve(sourcePath)
  const sourceStats = await stat(absoluteSource)

  if (sourceStats.isFile()) {
    const extension = path.extname(absoluteSource).toLowerCase()
    if (extension === '.skill' || extension === '.zip') {
      const extractedRoot = await expandArchive(absoluteSource)
      try {
        return await importLocalSkill(extractedRoot, explicitName)
      } finally {
        await rm(path.dirname(extractedRoot), { recursive: true, force: true }).catch(() => undefined)
      }
    }

    const targetName = normalizeSkillName(
      explicitName || path.basename(absoluteSource, path.extname(absoluteSource)),
    )
    const targetPath = path.join(SKILLS_DIR, `${targetName}.md`)
    await copyFile(absoluteSource, targetPath)
    const raw = await readFile(targetPath, 'utf8')
    const document = buildCompatCommandDocument({
      name: targetName,
      shortName: targetName,
      kind: 'skill',
      filePath: targetPath,
      rawMarkdown: raw,
      defaultUserInvocable: true,
    })
    return {
      ...toLocalSkill(document),
      source: 'roycode-data',
    }
  }

  if (!sourceStats.isDirectory()) {
    throw new Error('Skill source must be a markdown file, .skill archive, .zip archive, or a directory')
  }

  const targetName = normalizeSkillName(explicitName || path.basename(absoluteSource))
  const targetDir = path.join(SKILLS_DIR, targetName)
  const skillFilePath = path.join(absoluteSource, 'SKILL.md')
  if (!(await pathExists(skillFilePath))) {
    throw new Error('Skill directory must contain SKILL.md')
  }
  await copySkillDirectory(absoluteSource, targetDir)
  const raw = await readFile(path.join(targetDir, 'SKILL.md'), 'utf8')
  const document = buildCompatCommandDocument({
    name: targetName,
    shortName: targetName,
    kind: 'skill',
    filePath: path.join(targetDir, 'SKILL.md'),
    baseDir: targetDir,
    rawMarkdown: raw,
    defaultUserInvocable: true,
  })
  return {
    ...toLocalSkill(document),
    source: 'roycode-data',
  }
}

export async function buildActiveSkillSystemMessage(
  activeSkillNames: string[],
  options?: {
    workspaceRoot: string
    cwd: string
    accessMode: AccessMode
    sessionId: string
  },
): Promise<string | null> {
  if (!activeSkillNames.length) {
    return null
  }

  const documents: LocalSkillDocument[] = []
  for (const name of activeSkillNames) {
    const skill = await getLocalSkill(name, options?.workspaceRoot, options?.cwd || '.')
    if (skill) {
      documents.push(skill)
    }
  }

  if (!documents.length) {
    return null
  }

  const sections: string[] = []
  for (const skill of documents) {
    let renderedContent = skill.content.trim()
    if (options) {
      renderedContent = await buildCompatPrompt(
        {
          name: skill.name,
          shortName: skill.name,
          kind: 'skill',
          filePath: skill.filePath,
          baseDir: skill.baseDir,
          description: skill.summary,
          summary: skill.summary,
          content: skill.content,
          rawContent: skill.content,
          frontmatter: {},
          allowedTools: skill.allowedTools ?? [],
          argumentHint: skill.argumentHint,
          argumentNames: skill.argumentNames ?? [],
          whenToUse: skill.whenToUse,
          version: skill.version,
          model: skill.model,
          effort: skill.effort,
          userInvocable: skill.userInvocable ?? true,
          context: skill.context ?? 'inline',
          agent: skill.agent,
          shell: skill.shell,
        },
        {
          ...options,
          args: '',
          executeShell: false,
        },
      )
    }
    sections.push(`## Skill: ${skill.name}\nSource: ${skill.filePath}\n\n${renderedContent}`)
  }

  return [
    'Follow these active local skill instructions when they are relevant to the user request.',
    'If a skill conflicts with direct user instructions, follow the user.',
    '',
    sections.join('\n\n'),
  ].join('\n')
}

export async function buildLocalSkillPrompt(
  reference: string,
  options: {
    workspaceRoot: string
    cwd: string
    accessMode: AccessMode
    sessionId: string
    args?: string
    executeShell?: boolean
  },
): Promise<{ skill: LocalSkillDocument; prompt: string } | null> {
  const skill = await getLocalSkill(reference, options.workspaceRoot, options.cwd)
  if (!skill) {
    return null
  }

  const prompt = await buildCompatPrompt(
    {
      name: skill.name,
      shortName: skill.name,
      kind: 'skill',
      filePath: skill.filePath,
      baseDir: skill.baseDir,
      description: skill.summary,
      summary: skill.summary,
      content: skill.content,
      rawContent: skill.content,
      frontmatter: {},
      allowedTools: skill.allowedTools ?? [],
      argumentHint: skill.argumentHint,
      argumentNames: skill.argumentNames ?? [],
      whenToUse: skill.whenToUse,
      version: skill.version,
      model: skill.model,
      effort: skill.effort,
      userInvocable: skill.userInvocable ?? true,
      context: skill.context ?? 'inline',
      agent: skill.agent,
      shell: skill.shell,
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

  return { skill, prompt }
}
