import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  buildCompatCommandDocument,
  buildCompatPrompt,
  buildShortNameFromPath,
  parseMarkdownFrontmatter,
  type CompatCommandDocument,
} from './commandCompat.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const PLUGINS_DIR = path.join(DATA_DIR, 'plugins')
const PLUGINS_STORE_PATH = path.join(DATA_DIR, 'plugins.json')

type PluginStore = {
  plugins: PluginRecord[]
}

type PluginManifest = {
  name?: string
  version?: string
  description?: string
  author?: string
}

export type PluginRecord = {
  id: string
  name: string
  rootPath: string
  manifestPath?: string
  version?: string
  description: string
  enabled: boolean
  importedAt: string
  sourcePath?: string
}

export type PluginCommandDocument = CompatCommandDocument & {
  pluginName: string
  pluginId: string
}

export type PluginOutputStyleDocument = {
  pluginName: string
  pluginId: string
  name: string
  filePath: string
  description: string
  prompt: string
  keepCodingInstructions?: boolean
}

function createStore(): PluginStore {
  return { plugins: [] }
}

function normalizePluginName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Plugin name must contain letters or numbers')
  }
  return slug
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await mkdir(PLUGINS_DIR, { recursive: true })
  try {
    await readFile(PLUGINS_STORE_PATH, 'utf8')
  } catch {
    await writeFile(PLUGINS_STORE_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<PluginStore> {
  await ensureStore()
  const raw = await readFile(PLUGINS_STORE_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<PluginStore>
  return {
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
  }
}

async function writeStore(store: PluginStore): Promise<void> {
  await ensureStore()
  await writeFile(PLUGINS_STORE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function readPluginManifest(
  rootPath: string,
): Promise<{ manifest: PluginManifest; manifestPath?: string }> {
  const candidates = [
    path.join(rootPath, '.codex-plugin', 'plugin.json'),
    path.join(rootPath, 'plugin.json'),
  ]

  for (const manifestPath of candidates) {
    if (!(await pathExists(manifestPath))) {
      continue
    }
    const raw = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(raw.replace(/^\uFEFF/, '')) as PluginManifest
    return {
      manifest,
      manifestPath,
    }
  }

  return { manifest: {} }
}

async function walkMarkdownFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []

  async function visit(currentPath: string): Promise<void> {
    const entries = await readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') {
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

async function resolvePluginRecords(): Promise<PluginRecord[]> {
  const store = await readStore()
  const nextPlugins: PluginRecord[] = []
  let mutated = false

  for (const plugin of store.plugins) {
    if (!(await pathExists(plugin.rootPath))) {
      mutated = true
      continue
    }

    const manifestInfo = await readPluginManifest(plugin.rootPath)
    const nextPlugin: PluginRecord = {
      ...plugin,
      manifestPath: manifestInfo.manifestPath,
      version: manifestInfo.manifest.version ?? plugin.version,
      description:
        manifestInfo.manifest.description?.trim() ||
        plugin.description ||
        'No plugin description available.',
    }

    if (JSON.stringify(nextPlugin) !== JSON.stringify(plugin)) {
      mutated = true
    }
    nextPlugins.push(nextPlugin)
  }

  if (mutated) {
    await writeStore({ plugins: nextPlugins })
  }

  return nextPlugins.sort((left, right) => left.name.localeCompare(right.name))
}

export async function listInstalledPlugins(): Promise<PluginRecord[]> {
  return resolvePluginRecords()
}

export async function getInstalledPlugin(name: string): Promise<PluginRecord | null> {
  const normalized = normalizePluginName(name)
  const plugins = await resolvePluginRecords()
  return (
    plugins.find(plugin => plugin.name === normalized) ??
    plugins.find(plugin => plugin.name.startsWith(normalized)) ??
    null
  )
}

export async function importLocalPlugin(
  sourcePath: string,
  explicitName?: string,
): Promise<PluginRecord> {
  const absoluteSource = path.resolve(sourcePath)
  const sourceStats = await stat(absoluteSource)
  if (!sourceStats.isDirectory()) {
    throw new Error('Plugin source path must be a directory')
  }

  const sourceManifest = await readPluginManifest(absoluteSource)
  const targetName = normalizePluginName(
    explicitName || sourceManifest.manifest.name || path.basename(absoluteSource),
  )
  const targetRoot = path.join(PLUGINS_DIR, targetName)

  await ensureStore()
  await rm(targetRoot, { recursive: true, force: true })
  await cp(absoluteSource, targetRoot, {
    recursive: true,
    force: true,
  })

  const copiedManifest = await readPluginManifest(targetRoot)
  const now = new Date().toISOString()
  const nextRecord: PluginRecord = {
    id: `plugin_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`,
    name: targetName,
    rootPath: targetRoot,
    manifestPath: copiedManifest.manifestPath,
    version: copiedManifest.manifest.version,
    description: copiedManifest.manifest.description?.trim() || 'No plugin description available.',
    enabled: true,
    importedAt: now,
    sourcePath: absoluteSource,
  }

  const store = await readStore()
  const existingIndex = store.plugins.findIndex(plugin => plugin.name === targetName)
  if (existingIndex >= 0) {
    nextRecord.id = store.plugins[existingIndex]?.id || nextRecord.id
    nextRecord.importedAt = store.plugins[existingIndex]?.importedAt || now
    store.plugins[existingIndex] = nextRecord
  } else {
    store.plugins.push(nextRecord)
  }
  await writeStore(store)
  return nextRecord
}

export async function setPluginEnabled(name: string, enabled: boolean): Promise<PluginRecord> {
  const store = await readStore()
  const normalized = normalizePluginName(name)
  const index = store.plugins.findIndex(plugin => plugin.name === normalized)
  if (index < 0) {
    throw new Error(`Plugin not found: ${name}`)
  }
  const next = {
    ...store.plugins[index],
    enabled,
  }
  store.plugins[index] = next
  await writeStore(store)
  return next
}

export async function removePlugin(name: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizePluginName(name)
  const plugin = store.plugins.find(item => item.name === normalized)
  if (!plugin) {
    throw new Error(`Plugin not found: ${name}`)
  }

  store.plugins = store.plugins.filter(item => item.name !== normalized)
  await writeStore(store)
  if (plugin.rootPath.startsWith(PLUGINS_DIR)) {
    await rm(plugin.rootPath, { recursive: true, force: true })
  }
}

async function collectPluginDocuments(
  filter?: Partial<{ pluginName: string; kind: 'command' | 'skill' }>,
): Promise<PluginCommandDocument[]> {
  const plugins = await resolvePluginRecords()
  const documents: PluginCommandDocument[] = []

  for (const plugin of plugins) {
    if (!plugin.enabled) {
      continue
    }
    if (filter?.pluginName && plugin.name !== normalizePluginName(filter.pluginName)) {
      continue
    }

    const roots: Array<{ rootPath: string; kind: 'command' | 'skill' }> = []
    if (!filter?.kind || filter.kind === 'command') {
      roots.push(
        { rootPath: path.join(plugin.rootPath, 'commands'), kind: 'command' },
        { rootPath: path.join(plugin.rootPath, 'prompts'), kind: 'command' },
      )
    }
    if (!filter?.kind || filter.kind === 'skill') {
      roots.push({ rootPath: path.join(plugin.rootPath, 'skills'), kind: 'skill' })
    }

    for (const root of roots) {
      if (!(await pathExists(root.rootPath))) {
        continue
      }

      const files = await walkMarkdownFiles(root.rootPath)
      for (const filePath of files) {
        const raw = await readFile(filePath, 'utf8')
        const relative = path.relative(root.rootPath, filePath)
        const shortName = buildShortNameFromPath(relative, root.kind)
        const name = `${plugin.name}:${shortName}`
        const document = buildCompatCommandDocument({
          name,
          shortName,
          pluginName: plugin.name,
          kind: root.kind,
          filePath,
          baseDir: root.kind === 'skill' ? path.dirname(filePath) : undefined,
          rawMarkdown: raw,
          defaultUserInvocable: true,
        })

        documents.push({
          pluginName: plugin.name,
          pluginId: plugin.id,
          ...document,
        })
      }
    }
  }

  const unique = new Map<string, PluginCommandDocument>()
  for (const document of documents) {
    unique.set(document.name.toLowerCase(), document)
  }

  return [...unique.values()].sort((left, right) => left.name.localeCompare(right.name))
}

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

export async function listPluginOutputStyles(): Promise<PluginOutputStyleDocument[]> {
  const plugins = await resolvePluginRecords()
  const styles = new Map<string, PluginOutputStyleDocument>()

  for (const plugin of plugins) {
    if (!plugin.enabled) {
      continue
    }

    const outputStylesRoot = path.join(plugin.rootPath, 'output-styles')
    if (!(await pathExists(outputStylesRoot))) {
      continue
    }

    const files = await walkMarkdownFiles(outputStylesRoot)
    for (const filePath of files) {
      const raw = await readFile(filePath, 'utf8')
      const { frontmatter, body } = parseMarkdownFrontmatter(raw)
      const relative = path.relative(outputStylesRoot, filePath)
      const fallbackName = buildShortNameFromPath(relative, 'command')
      const name = normalizeText(frontmatter.name) || fallbackName
      const description =
        normalizeText(frontmatter.description) ||
        body
          .split(/\r?\n/)
          .map(line => line.trim())
          .find(Boolean) ||
        `Plugin output style from ${plugin.name}`

      styles.set(name.toLowerCase(), {
        pluginName: plugin.name,
        pluginId: plugin.id,
        name,
        filePath,
        description,
        prompt: body.trim(),
        keepCodingInstructions: normalizeBoolean(frontmatter['keep-coding-instructions']),
      })
    }
  }

  return [...styles.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function listPluginCommands(
  pluginName?: string,
): Promise<PluginCommandDocument[]> {
  return collectPluginDocuments({
    pluginName,
    kind: 'command',
  })
}

export async function listPluginSkills(): Promise<PluginCommandDocument[]> {
  return collectPluginDocuments({
    kind: 'skill',
  })
}

export async function getPluginCommand(
  reference: string,
  kind: 'command' | 'skill' = 'command',
): Promise<PluginCommandDocument | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    return null
  }

  const documents = await collectPluginDocuments({ kind })
  return (
    documents.find(item => item.name.toLowerCase() === normalized) ??
    documents.find(item => item.shortName.toLowerCase() === normalized) ??
    documents.find(item => item.name.toLowerCase().startsWith(normalized)) ??
    documents.find(item => item.name.toLowerCase().includes(normalized)) ??
    null
  )
}

export async function getPluginSkill(reference: string): Promise<PluginCommandDocument | null> {
  return getPluginCommand(reference, 'skill')
}

export async function buildPluginCommandPrompt(
  reference: string,
  rawArgs: string,
  options?: {
    workspaceRoot: string
    cwd: string
    accessMode: 'workspace' | 'unrestricted'
    sessionId: string
    executeShell?: boolean
  },
): Promise<{ command: PluginCommandDocument; prompt: string } | null> {
  const command = await getPluginCommand(reference, 'command')
  if (!command) {
    return null
  }

  const prompt = options
    ? await buildCompatPrompt(command, {
        workspaceRoot: options.workspaceRoot,
        cwd: options.cwd,
        accessMode: options.accessMode,
        sessionId: options.sessionId,
        args: rawArgs,
        executeShell: options.executeShell ?? true,
      })
    : command.content

  return {
    command,
    prompt,
  }
}
