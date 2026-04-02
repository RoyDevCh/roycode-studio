import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')

const EXPORTABLE_FILES = [
  'settings.json',
  'hooks.json',
  'teams.json',
  'bridges.json',
  'marketplace.json',
  'mcp-servers.json',
  'plugins.json',
] as const

const EXPORTABLE_DIRECTORIES = ['skills', 'plugins'] as const

type SyncEntry = {
  path: string
  encoding: 'utf8' | 'base64'
  content: string
}

export type SettingsSyncBundle = {
  version: 1
  exportedAt: string
  exportedFrom: string
  redacted: boolean
  entries: SyncEntry[]
}

export type SettingsSyncStatus = {
  dataDir: string
  fileEntries: string[]
  directoryEntries: string[]
  totalEntries: number
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function listFilesRecursive(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await listFilesRecursive(absolutePath)))
      continue
    }
    if (entry.isFile()) {
      results.push(absolutePath)
    }
  }
  return results
}

function maybeRedactSecrets(filePath: string, content: string, redacted: boolean): string {
  const normalizedContent = content.replace(/^\uFEFF/, '')
  if (!redacted) {
    return normalizedContent
  }
  if (filePath.replace(/\\/g, '/').endsWith('/settings.json')) {
    try {
      const parsed = JSON.parse(normalizedContent) as {
        providers?: Array<Record<string, unknown>>
      }
      if (Array.isArray(parsed.providers)) {
        parsed.providers = parsed.providers.map(provider => ({
          ...provider,
          apiKey: typeof provider.apiKey === 'string' && provider.apiKey ? '__REDACTED__' : '',
        }))
      }
      return JSON.stringify(parsed, null, 2)
    } catch {
      return normalizedContent
    }
  }
  return normalizedContent
}

function normalizeSyncPath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

export async function describeSettingsSync(): Promise<SettingsSyncStatus> {
  const fileEntries: string[] = []
  const directoryEntries: string[] = []

  for (const fileName of EXPORTABLE_FILES) {
    const absolutePath = path.join(DATA_DIR, fileName)
    if (await pathExists(absolutePath)) {
      fileEntries.push(fileName)
    }
  }

  for (const directoryName of EXPORTABLE_DIRECTORIES) {
    const absolutePath = path.join(DATA_DIR, directoryName)
    if (!(await pathExists(absolutePath))) {
      continue
    }
    const files = await listFilesRecursive(absolutePath)
    directoryEntries.push(
      ...files.map(filePath => normalizeSyncPath(path.relative(DATA_DIR, filePath))),
    )
  }

  return {
    dataDir: DATA_DIR,
    fileEntries,
    directoryEntries,
    totalEntries: fileEntries.length + directoryEntries.length,
  }
}

export async function exportSettingsBundle(
  targetPath: string,
  options: {
    redactSecrets?: boolean
  } = {},
): Promise<{
  bundlePath: string
  entryCount: number
  redacted: boolean
}> {
  const redacted = options.redactSecrets === true
  const entries: SyncEntry[] = []

  for (const fileName of EXPORTABLE_FILES) {
    const absolutePath = path.join(DATA_DIR, fileName)
    if (!(await pathExists(absolutePath))) {
      continue
    }
    const raw = await readFile(absolutePath, 'utf8')
    entries.push({
      path: fileName,
      encoding: 'utf8',
      content: maybeRedactSecrets(absolutePath, raw, redacted),
    })
  }

  for (const directoryName of EXPORTABLE_DIRECTORIES) {
    const absolutePath = path.join(DATA_DIR, directoryName)
    if (!(await pathExists(absolutePath))) {
      continue
    }
    const files = await listFilesRecursive(absolutePath)
    for (const filePath of files) {
      const relativePath = normalizeSyncPath(path.relative(DATA_DIR, filePath))
      const buffer = await readFile(filePath)
      const looksText = !buffer.includes(0)
      entries.push({
        path: relativePath,
        encoding: looksText ? 'utf8' : 'base64',
        content: looksText
          ? maybeRedactSecrets(filePath, buffer.toString('utf8'), redacted)
          : buffer.toString('base64'),
      })
    }
  }

  const bundle: SettingsSyncBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedFrom: DATA_DIR,
    redacted,
    entries: entries.sort((left, right) => left.path.localeCompare(right.path)),
  }

  const resolvedTargetPath = path.resolve(targetPath)
  await mkdir(path.dirname(resolvedTargetPath), { recursive: true })
  await writeFile(resolvedTargetPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8')
  return {
    bundlePath: resolvedTargetPath,
    entryCount: entries.length,
    redacted,
  }
}

export async function importSettingsBundle(
  bundlePath: string,
): Promise<{
  bundlePath: string
  entryCount: number
}> {
  const resolvedBundlePath = path.resolve(bundlePath)
  const raw = await readFile(resolvedBundlePath, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<SettingsSyncBundle>
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error('Invalid RoyCode settings sync bundle')
  }

  let importedCount = 0
  for (const entry of parsed.entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.path !== 'string' ||
      typeof entry.content !== 'string' ||
      (entry.encoding !== 'utf8' && entry.encoding !== 'base64')
    ) {
      continue
    }

    const normalizedRelativePath = normalizeSyncPath(entry.path)
    const absolutePath = path.resolve(DATA_DIR, normalizedRelativePath)
    if (!absolutePath.startsWith(`${DATA_DIR}${path.sep}`) && absolutePath !== DATA_DIR) {
      throw new Error(`Refusing to import path outside RoyCode data dir: ${entry.path}`)
    }

    await mkdir(path.dirname(absolutePath), { recursive: true })
    let content =
      entry.encoding === 'base64'
        ? Buffer.from(entry.content, 'base64')
        : entry.content.replace(/^\uFEFF/, '')

    if (
      entry.encoding === 'utf8' &&
      normalizedRelativePath === 'settings.json' &&
      content.includes('__REDACTED__')
    ) {
      try {
        const currentRaw = await readFile(absolutePath, 'utf8').catch(() => '')
        const currentSettings = currentRaw
          ? (JSON.parse(currentRaw.replace(/^\uFEFF/, '')) as {
              providers?: Array<Record<string, unknown>>
            })
          : { providers: [] }
        const importedSettings = JSON.parse(String(content)) as {
          providers?: Array<Record<string, unknown>>
        }

        if (Array.isArray(importedSettings.providers) && Array.isArray(currentSettings.providers)) {
          importedSettings.providers = importedSettings.providers.map(importedProvider => {
            const importedId = String(importedProvider.id ?? '')
            const currentProvider = currentSettings.providers?.find(
              provider => String(provider.id ?? '') === importedId,
            )
            if (importedProvider.apiKey === '__REDACTED__' && typeof currentProvider?.apiKey === 'string') {
              return {
                ...importedProvider,
                apiKey: currentProvider.apiKey,
              }
            }
            return importedProvider
          })
        }

        content = `${JSON.stringify(importedSettings, null, 2)}`
      } catch {
        // Keep the imported content if either side is malformed.
      }
    }

    await writeFile(absolutePath, content, entry.encoding === 'base64' ? undefined : 'utf8')
    importedCount += 1
  }

  return {
    bundlePath: resolvedBundlePath,
    entryCount: importedCount,
  }
}
