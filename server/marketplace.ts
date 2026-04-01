import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { importLocalPlugin } from './pluginRuntime.js'
import { importLocalSkill } from './skills.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const MARKETPLACE_PATH = path.join(DATA_DIR, 'marketplace.json')

export type MarketplaceItemType = 'plugin' | 'skill' | 'auto'

export type MarketplaceItem = {
  id: string
  name: string
  type: MarketplaceItemType
  source: string
  description?: string
  installedAt?: string
  createdAt: string
  updatedAt: string
}

type MarketplaceStore = {
  items: MarketplaceItem[]
}

function createStore(): MarketplaceStore {
  return { items: [] }
}

function normalizeName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('Marketplace name must contain letters or numbers')
  }
  return slug
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(MARKETPLACE_PATH, 'utf8')
  } catch {
    await writeFile(MARKETPLACE_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<MarketplaceStore> {
  await ensureStore()
  const raw = await readFile(MARKETPLACE_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<MarketplaceStore>
  return {
    items: Array.isArray(parsed.items) ? parsed.items : [],
  }
}

async function writeStore(store: MarketplaceStore): Promise<void> {
  await ensureStore()
  await writeFile(MARKETPLACE_PATH, JSON.stringify(store, null, 2), 'utf8')
}

async function runCommand(
  command: string,
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', exitCode => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
      })
    })
  })
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function detectInstallTarget(rootPath: string, requestedType: MarketplaceItemType): Promise<{
  type: 'plugin' | 'skill'
  targetPath: string
}> {
  const pluginManifest = path.join(rootPath, '.codex-plugin', 'plugin.json')
  const skillFile = path.join(rootPath, 'SKILL.md')

  const hasPlugin = await pathExists(pluginManifest)
  const hasSkill = await pathExists(skillFile)

  if (requestedType === 'plugin') {
    if (!hasPlugin) {
      throw new Error('Marketplace source does not look like a plugin')
    }
    return { type: 'plugin', targetPath: rootPath }
  }

  if (requestedType === 'skill') {
    if (hasSkill) {
      return { type: 'skill', targetPath: rootPath }
    }
    throw new Error('Marketplace source does not look like a skill')
  }

  if (hasPlugin) {
    return { type: 'plugin', targetPath: rootPath }
  }
  if (hasSkill) {
    return { type: 'skill', targetPath: rootPath }
  }

  throw new Error('Unable to detect whether marketplace source is a plugin or a skill')
}

async function cloneIfNeeded(source: string): Promise<{ rootPath: string; cleanup?: () => Promise<void> }> {
  const normalized = source.trim()
  if (/^(https?:\/\/|git@|github:|gh:)/i.test(normalized) || normalized.endsWith('.git')) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'roycode-marketplace-'))
    const target = path.join(tempRoot, 'repo')
    const cloneSource = normalized
      .replace(/^github:/i, 'https://github.com/')
      .replace(/^gh:/i, 'https://github.com/')
    const result = await runCommand('git', ['clone', '--depth', '1', cloneSource, target])
    if (result.exitCode !== 0) {
      await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
      throw new Error(result.stderr || result.stdout || 'Failed to clone marketplace source')
    }
    return {
      rootPath: target,
      cleanup: async () => {
        await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
      },
    }
  }

  return {
    rootPath: path.resolve(normalized),
  }
}

export async function listMarketplaceItems(): Promise<MarketplaceItem[]> {
  const store = await readStore()
  return [...store.items].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getMarketplaceItem(reference: string): Promise<MarketplaceItem | null> {
  const normalized = normalizeName(reference)
  const items = await listMarketplaceItems()
  return (
    items.find(item => item.name === normalized) ??
    items.find(item => item.name.startsWith(normalized)) ??
    items.find(item => item.name.includes(normalized)) ??
    null
  )
}

export async function addMarketplaceItem(args: {
  name: string
  type: MarketplaceItemType
  source: string
  description?: string
}): Promise<MarketplaceItem> {
  const store = await readStore()
  const name = normalizeName(args.name)
  const now = new Date().toISOString()
  const next: MarketplaceItem = {
    id: `market_${Date.now().toString(36)}`,
    name,
    type: args.type,
    source: args.source.trim(),
    description: args.description?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  }

  const index = store.items.findIndex(item => item.name === name)
  if (index >= 0) {
    next.id = store.items[index]?.id ?? next.id
    next.createdAt = store.items[index]?.createdAt ?? now
    next.installedAt = store.items[index]?.installedAt
    store.items[index] = next
  } else {
    store.items.push(next)
  }

  await writeStore(store)
  return next
}

export async function removeMarketplaceItem(reference: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizeName(reference)
  store.items = store.items.filter(item => item.name !== normalized)
  await writeStore(store)
}

export async function installMarketplaceItem(reference: string): Promise<{
  item: MarketplaceItem
  installedAs: string
  installedType: 'plugin' | 'skill'
}> {
  const item = await getMarketplaceItem(reference)
  if (!item) {
    throw new Error(`Marketplace item not found: ${reference}`)
  }

  const acquired = await cloneIfNeeded(item.source)
  try {
    const detected = await detectInstallTarget(acquired.rootPath, item.type)
    let installedAs = item.name

    if (detected.type === 'plugin') {
      const plugin = await importLocalPlugin(detected.targetPath, item.name)
      installedAs = plugin.name
    } else {
      const skill = await importLocalSkill(detected.targetPath, item.name)
      installedAs = skill.name
    }

    const store = await readStore()
    const normalized = normalizeName(item.name)
    const match = store.items.find(entry => entry.name === normalized)
    if (match) {
      match.installedAt = new Date().toISOString()
      match.updatedAt = new Date().toISOString()
      await writeStore(store)
    }

    return {
      item,
      installedAs,
      installedType: detected.type,
    }
  } finally {
    if (acquired.cleanup) {
      await acquired.cleanup()
    }
  }
}
