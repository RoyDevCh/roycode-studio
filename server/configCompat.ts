import type { AppSettings } from './types.js'

export type CompatConfigEntry = {
  key: string
  description: string
  value: unknown
  type: 'string' | 'boolean' | 'number' | 'enum'
  options?: string[]
}

type ConfigHandler = {
  key: string
  description: string
  type: 'string' | 'boolean' | 'number' | 'enum'
  options?: string[]
  aliases?: string[]
  get: (settings: AppSettings) => unknown
  set: (settings: AppSettings, value: string | number | boolean) => AppSettings
}

function inferPermissionPreset(settings: AppSettings): 'workspace' | 'safe' | 'full' {
  if (settings.accessMode === 'workspace') {
    return 'workspace'
  }
  return settings.safeWriteMode ? 'safe' : 'full'
}

function parseBooleanLike(value: string | number | boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    return value !== 0
  }
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'off', 'disabled'].includes(normalized)) {
    return false
  }
  throw new Error(`Expected boolean value, received "${value}"`)
}

function parseIntegerLike(
  value: string | number | boolean,
  key: string,
  min?: number,
  max?: number,
): number {
  const parsed =
    typeof value === 'number'
      ? Math.trunc(value)
      : Number.parseInt(String(value).trim(), 10)
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected integer value for ${key}`)
  }
  if (typeof min === 'number' && parsed < min) {
    throw new Error(`${key} must be >= ${min}`)
  }
  if (typeof max === 'number' && parsed > max) {
    throw new Error(`${key} must be <= ${max}`)
  }
  return parsed
}

const CONFIG_HANDLERS: ConfigHandler[] = [
  {
    key: 'appName',
    description: 'Application name shown in RoyCode surfaces.',
    type: 'string',
    get: settings => settings.appName,
    set: (settings, value) => ({ ...settings, appName: String(value).trim() || settings.appName }),
  },
  {
    key: 'workspaceRoot',
    description: 'Default workspace root used for file and shell tools.',
    type: 'string',
    aliases: ['workspace.root'],
    get: settings => settings.workspaceRoot,
    set: (settings, value) => ({ ...settings, workspaceRoot: String(value).trim() || settings.workspaceRoot }),
  },
  {
    key: 'additionalWorkspaceRoots',
    description: 'Extra directories allowed while still in workspace access mode.',
    type: 'string',
    aliases: ['workspace.additionalRoots', 'workspace.additionalDirs'],
    get: settings => (settings.additionalWorkspaceRoots ?? []).join(', '),
    set: (settings, value) => ({
      ...settings,
      additionalWorkspaceRoots: String(value)
        .split(/[\n,;]/)
        .map(item => item.trim())
        .filter(Boolean),
    }),
  },
  {
    key: 'accessMode',
    description: 'Filesystem access mode: workspace or unrestricted.',
    type: 'enum',
    options: ['workspace', 'unrestricted'],
    aliases: ['permissions.mode'],
    get: settings => settings.accessMode,
    set: (settings, value) => {
      const normalized = String(value).trim().toLowerCase()
      if (normalized !== 'workspace' && normalized !== 'unrestricted') {
        throw new Error('accessMode must be workspace or unrestricted')
      }
      return { ...settings, accessMode: normalized }
    },
  },
  {
    key: 'theme',
    description: 'Preferred RoyCode terminal theme: dark, light, or auto.',
    type: 'enum',
    options: ['dark', 'light', 'auto'],
    aliases: ['ui.theme'],
    get: settings => settings.theme ?? 'dark',
    set: (settings, value) => {
      const normalized = String(value).trim().toLowerCase()
      if (!['dark', 'light', 'auto'].includes(normalized)) {
        throw new Error('theme must be dark, light, or auto')
      }
      return { ...settings, theme: normalized as AppSettings['theme'] }
    },
  },
  {
    key: 'vimMode',
    description: 'Whether RoyCode should prefer Vim-style editing mode where supported.',
    type: 'boolean',
    aliases: ['vim', 'ui.vim'],
    get: settings => settings.vimMode ?? false,
    set: (settings, value) => ({ ...settings, vimMode: parseBooleanLike(value) }),
  },
  {
    key: 'briefMode',
    description: 'Whether RoyCode should prefer concise brief-mode answers.',
    type: 'boolean',
    aliases: ['brief', 'ui.brief'],
    get: settings => settings.briefMode ?? false,
    set: (settings, value) => ({ ...settings, briefMode: parseBooleanLike(value) }),
  },
  {
    key: 'voiceMode',
    description: 'Whether RoyCode should speak assistant answers locally when supported.',
    type: 'boolean',
    aliases: ['voice', 'ui.voice'],
    get: settings => settings.voiceMode ?? false,
    set: (settings, value) => ({ ...settings, voiceMode: parseBooleanLike(value) }),
  },
  {
    key: 'effortLevel',
    description: 'Preferred reasoning depth: auto, low, medium, high, or max.',
    type: 'enum',
    options: ['auto', 'low', 'medium', 'high', 'max'],
    aliases: ['effort', 'reasoning.effort'],
    get: settings => settings.effortLevel ?? 'auto',
    set: (settings, value) => {
      const normalized = String(value).trim().toLowerCase()
      if (!['auto', 'low', 'medium', 'high', 'max'].includes(normalized)) {
        throw new Error('effortLevel must be auto, low, medium, high, or max')
      }
      return { ...settings, effortLevel: normalized as AppSettings['effortLevel'] }
    },
  },
  {
    key: 'promptSuggestionEnabled',
    description: 'Whether RoyCode should offer local next-prompt suggestions.',
    type: 'boolean',
    aliases: ['suggestions', 'suggest', 'ui.suggestions'],
    get: settings => settings.promptSuggestionEnabled ?? true,
    set: (settings, value) => ({
      ...settings,
      promptSuggestionEnabled: parseBooleanLike(value),
    }),
  },
  {
    key: 'notificationsEnabled',
    description: 'Whether RoyCode should send local desktop notifications when supported.',
    type: 'boolean',
    aliases: ['notifications', 'notify', 'ui.notifications'],
    get: settings => settings.notificationsEnabled ?? false,
    set: (settings, value) => ({
      ...settings,
      notificationsEnabled: parseBooleanLike(value),
    }),
  },
  {
    key: 'sleepGuardMode',
    description: 'Whether RoyCode should keep a local sleep-prevention guard active when supported.',
    type: 'boolean',
    aliases: ['sleep-guard', 'sleepGuard', 'runtime.sleepGuard'],
    get: settings => settings.sleepGuardMode ?? false,
    set: (settings, value) => ({
      ...settings,
      sleepGuardMode: parseBooleanLike(value),
    }),
  },
  {
    key: 'advisorModel',
    description: 'Optional secondary model used for advisor passes and second opinions.',
    type: 'string',
    aliases: ['advisor', 'models.advisor'],
    get: settings => settings.advisorModel ?? '',
    set: (settings, value) => ({
      ...settings,
      advisorModel: String(value).trim(),
    }),
  },
  {
    key: 'permissions.defaultMode',
    description: 'Claude-style permission preset: workspace, safe, or full.',
    type: 'enum',
    options: ['workspace', 'safe', 'full'],
    aliases: ['permissions.default-mode'],
    get: settings => inferPermissionPreset(settings),
    set: (settings, value) => {
      const normalized = String(value).trim().toLowerCase()
      if (normalized === 'workspace') {
        return { ...settings, accessMode: 'workspace', safeWriteMode: true }
      }
      if (normalized === 'safe') {
        return { ...settings, accessMode: 'unrestricted', safeWriteMode: true }
      }
      if (normalized === 'full' || normalized === 'danger' || normalized === 'dangerous') {
        return { ...settings, accessMode: 'unrestricted', safeWriteMode: false }
      }
      throw new Error('permissions.defaultMode must be workspace, safe, or full')
    },
  },
  {
    key: 'safeWriteMode',
    description: 'Whether edits are staged for approval instead of written directly.',
    type: 'boolean',
    aliases: ['safe-write', 'safeWrite'],
    get: settings => settings.safeWriteMode,
    set: (settings, value) => ({ ...settings, safeWriteMode: parseBooleanLike(value) }),
  },
  {
    key: 'outputStyle',
    description: 'Default output style or custom style name.',
    type: 'string',
    aliases: ['output.style'],
    get: settings => settings.outputStyle || 'default',
    set: (settings, value) => ({ ...settings, outputStyle: String(value).trim() || 'default' }),
  },
  {
    key: 'cleanupPeriodDays',
    description: 'Retention window used for cleanup-oriented features.',
    type: 'number',
    aliases: ['cleanup.days'],
    get: settings => settings.cleanupPeriodDays ?? 30,
    set: (settings, value) => ({
      ...settings,
      cleanupPeriodDays: parseIntegerLike(value, 'cleanupPeriodDays', 1, 3650),
    }),
  },
  {
    key: 'defaultShell',
    description: 'Default shell used when a command does not request one explicitly.',
    type: 'enum',
    options: ['powershell', 'bash'],
    aliases: ['shell.default'],
    get: settings => settings.defaultShell ?? 'powershell',
    set: (settings, value) => {
      const normalized = String(value).trim().toLowerCase()
      if (normalized !== 'powershell' && normalized !== 'bash') {
        throw new Error('defaultShell must be powershell or bash')
      }
      return { ...settings, defaultShell: normalized }
    },
  },
  {
    key: 'shellEnvKeys',
    description: 'Read-only list of persisted shell environment override keys.',
    type: 'string',
    aliases: ['shell.envKeys'],
    get: settings => Object.keys(settings.shellEnv ?? {}).sort().join(', '),
    set: settings => settings,
  },
  {
    key: 'enableAllProjectMcpServers',
    description: 'Whether workspace .mcp.json servers are auto-enabled alongside saved servers.',
    type: 'boolean',
    aliases: ['mcp.enableAllProjectMcpServers', 'mcp.projectServers'],
    get: settings => settings.enableAllProjectMcpServers ?? true,
    set: (settings, value) => ({ ...settings, enableAllProjectMcpServers: parseBooleanLike(value) }),
  },
  {
    key: 'selectedProviderId',
    description: 'Default provider used for new RoyCode turns.',
    type: 'string',
    aliases: ['provider'],
    get: settings => settings.selectedProviderId ?? '',
    set: (settings, value) => {
      const nextId = String(value).trim()
      if (!nextId) {
        throw new Error('Provider id cannot be empty')
      }
      const provider = settings.providers.find(item => item.id === nextId || item.name === nextId)
      if (!provider) {
        throw new Error(`Provider not found: ${nextId}`)
      }
      return {
        ...settings,
        selectedProviderId: provider.id,
        selectedModel:
          provider.models.includes(settings.selectedModel || '')
            ? settings.selectedModel
            : provider.defaultModel ?? provider.models[0] ?? settings.selectedModel,
      }
    },
  },
  {
    key: 'selectedModel',
    description: 'Default model name used for new RoyCode turns.',
    type: 'string',
    aliases: ['model'],
    get: settings => settings.selectedModel ?? '',
    set: (settings, value) => ({ ...settings, selectedModel: String(value).trim() || settings.selectedModel }),
  },
  {
    key: 'commandTimeoutMs',
    description: 'Maximum shell command timeout in milliseconds.',
    type: 'number',
    aliases: ['shell.timeoutMs', 'command.timeoutMs'],
    get: settings => settings.commandTimeoutMs,
    set: (settings, value) => ({
      ...settings,
      commandTimeoutMs: parseIntegerLike(value, 'commandTimeoutMs', 1000, 120000),
    }),
  },
  {
    key: 'maxAgentSteps',
    description: 'Maximum tool loop steps allowed per model turn.',
    type: 'number',
    aliases: ['agent.maxSteps'],
    get: settings => settings.maxAgentSteps,
    set: (settings, value) => ({
      ...settings,
      maxAgentSteps: parseIntegerLike(value, 'maxAgentSteps', 1, 32),
    }),
  },
  {
    key: 'systemPrompt',
    description: 'Base system prompt for RoyCode.',
    type: 'string',
    aliases: ['prompt.system'],
    get: settings => settings.systemPrompt,
    set: (settings, value) => ({ ...settings, systemPrompt: String(value) }),
  },
]

function normalizeConfigKey(reference: string): string {
  return reference.trim().toLowerCase()
}

export function listSupportedConfigEntries(settings: AppSettings): CompatConfigEntry[] {
  return CONFIG_HANDLERS.map(handler => ({
    key: handler.key,
    description: handler.description,
    value: handler.get(settings),
    type: handler.type,
    options: handler.options,
  }))
}

export function getSupportedConfigKeys(): string[] {
  return CONFIG_HANDLERS.map(handler => handler.key)
}

function resolveConfigHandler(reference: string): ConfigHandler | null {
  const normalized = normalizeConfigKey(reference)
  if (!normalized) {
    return null
  }

  return (
    CONFIG_HANDLERS.find(handler => normalizeConfigKey(handler.key) === normalized) ??
    CONFIG_HANDLERS.find(handler => handler.aliases?.some(alias => normalizeConfigKey(alias) === normalized)) ??
    CONFIG_HANDLERS.find(handler => normalizeConfigKey(handler.key).startsWith(normalized)) ??
    CONFIG_HANDLERS.find(handler => normalizeConfigKey(handler.key).includes(normalized)) ??
    null
  )
}

export function getCompatConfigValue(
  settings: AppSettings,
  reference: string,
): CompatConfigEntry | null {
  const handler = resolveConfigHandler(reference)
  if (!handler) {
    return null
  }
  return {
    key: handler.key,
    description: handler.description,
    value: handler.get(settings),
    type: handler.type,
    options: handler.options,
  }
}

export function setCompatConfigValue(
  settings: AppSettings,
  reference: string,
  rawValue: string | number | boolean,
): {
  entry: CompatConfigEntry
  previousValue: unknown
  settings: AppSettings
} {
  const handler = resolveConfigHandler(reference)
  if (!handler) {
    throw new Error(`Unknown config setting: ${reference}`)
  }
  const previousValue = handler.get(settings)
  const nextSettings = handler.set(settings, rawValue)
  return {
    entry: {
      key: handler.key,
      description: handler.description,
      value: handler.get(nextSettings),
      type: handler.type,
      options: handler.options,
    },
    previousValue,
    settings: nextSettings,
  }
}
