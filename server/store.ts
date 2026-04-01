import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProviderFromPreset } from './presets.js'
import type {
  AppSettings,
  ProviderConfig,
  ProviderPublic,
  PublicSettings,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json')
const DEFAULT_WORKSPACE_ROOT = process.env.ROYCODE_DEFAULT_WORKSPACE_ROOT
  ? path.resolve(process.env.ROYCODE_DEFAULT_WORKSPACE_ROOT)
  : path.resolve(APP_ROOT, '..')

function getDefaultSettings(): AppSettings {
  const deepseek = createProviderFromPreset('deepseek')
  const minimax = createProviderFromPreset('minimax')

  return {
    appName: 'RoyCode Studio',
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    accessMode: 'workspace',
    theme: 'dark',
    vimMode: false,
    outputStyle: 'default',
    cleanupPeriodDays: 30,
    defaultShell: 'powershell',
    enableAllProjectMcpServers: true,
    selectedProviderId: deepseek.id,
    selectedModel: deepseek.defaultModel,
    systemPrompt:
      'You are RoyCode Studio, a local AI coding assistant focused on code and engineering tasks. Prefer reading with tools before editing, keep changes minimal, and answer clearly.',
    commandTimeoutMs: 20000,
    maxAgentSteps: 8,
    safeWriteMode: true,
    providers: [deepseek, minimax],
  }
}

function applySettingsToRuntime(settings: AppSettings): AppSettings {
  process.env.ROYCODE_DEFAULT_SHELL = settings.defaultShell ?? 'powershell'
  process.env.ROYCODE_ENABLE_ALL_PROJECT_MCP_SERVERS =
    settings.enableAllProjectMcpServers === false ? 'false' : 'true'
  return settings
}

function normalizeSettings(raw: Partial<AppSettings>): AppSettings {
  const defaults = getDefaultSettings()
  return {
    ...defaults,
    ...raw,
    providers: raw.providers ?? defaults.providers,
    accessMode: raw.accessMode ?? defaults.accessMode,
    theme:
      raw.theme === 'light' || raw.theme === 'dark' || raw.theme === 'auto'
        ? raw.theme
        : defaults.theme,
    vimMode: typeof raw.vimMode === 'boolean' ? raw.vimMode : defaults.vimMode,
    safeWriteMode: raw.safeWriteMode ?? defaults.safeWriteMode,
    outputStyle: raw.outputStyle ?? defaults.outputStyle,
    cleanupPeriodDays:
      typeof raw.cleanupPeriodDays === 'number'
        ? raw.cleanupPeriodDays
        : defaults.cleanupPeriodDays,
    defaultShell:
      raw.defaultShell === 'bash' || raw.defaultShell === 'powershell'
        ? raw.defaultShell
        : defaults.defaultShell,
    enableAllProjectMcpServers:
      typeof raw.enableAllProjectMcpServers === 'boolean'
        ? raw.enableAllProjectMcpServers
        : defaults.enableAllProjectMcpServers,
  }
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(SETTINGS_PATH, 'utf8')
  } catch {
    await writeFile(
      SETTINGS_PATH,
      JSON.stringify(getDefaultSettings(), null, 2),
      'utf8',
    )
  }
}

export async function readSettings(): Promise<AppSettings> {
  await ensureStore()
  const raw = await readFile(SETTINGS_PATH, 'utf8')
  return applySettingsToRuntime(
    normalizeSettings(JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<AppSettings>),
  )
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await ensureStore()
  const normalized = applySettingsToRuntime(normalizeSettings(settings))
  await writeFile(
    SETTINGS_PATH,
    JSON.stringify(normalized, null, 2),
    'utf8',
  )
}

export function toPublicProvider(provider: ProviderConfig): ProviderPublic {
  const { apiKey: _apiKey, ...rest } = provider
  return {
    ...rest,
    hasApiKey: Boolean(provider.apiKey),
  }
}

export function toPublicSettings(settings: AppSettings): PublicSettings {
  return {
    ...settings,
    providers: settings.providers.map(toPublicProvider),
  }
}
