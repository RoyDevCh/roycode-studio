import type { AppSettings } from './types.js'

export type RoyCodeFeatureFlag =
  | 'web-tools'
  | 'magic-docs'
  | 'github-context'
  | 'mcp'
  | 'subagents'
  | 'teams'
  | 'worktrees'
  | 'notebooks'
  | 'lsp'
  | 'voice'
  | 'diagnostics'
  | 'remote-bridges'

export type FeatureFlagDefinition = {
  key: RoyCodeFeatureFlag
  description: string
  defaultEnabled: boolean
  aliases?: string[]
}

export type FeatureFlagState = FeatureFlagDefinition & {
  enabled: boolean
}

const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'web-tools',
    description: 'Enable public web search and readable web fetch helpers.',
    defaultEnabled: true,
    aliases: ['web', 'web-search'],
  },
  {
    key: 'magic-docs',
    description: 'Enable local markdown/text documentation discovery and search.',
    defaultEnabled: true,
    aliases: ['docs', 'magicdocs'],
  },
  {
    key: 'github-context',
    description: 'Enable GitHub issue and pull-request comment inspection helpers.',
    defaultEnabled: true,
    aliases: ['github', 'issues', 'pr-comments'],
  },
  {
    key: 'mcp',
    description: 'Enable local MCP server tools, prompts, and resources.',
    defaultEnabled: true,
  },
  {
    key: 'subagents',
    description: 'Enable local subagent and skill-fork execution.',
    defaultEnabled: true,
    aliases: ['agents'],
  },
  {
    key: 'teams',
    description: 'Enable local teams, team memory, and fan-out task helpers.',
    defaultEnabled: true,
  },
  {
    key: 'worktrees',
    description: 'Enable local git worktree and teleport helpers.',
    defaultEnabled: true,
    aliases: ['worktree'],
  },
  {
    key: 'notebooks',
    description: 'Enable local notebook cell editing helpers.',
    defaultEnabled: true,
    aliases: ['notebook'],
  },
  {
    key: 'lsp',
    description: 'Enable local TypeScript/JavaScript code intelligence helpers.',
    defaultEnabled: true,
  },
  {
    key: 'voice',
    description: 'Enable local text-to-speech and speech-to-text helpers.',
    defaultEnabled: true,
  },
  {
    key: 'diagnostics',
    description: 'Enable diagnostics, trace capture, and debug inspection helpers.',
    defaultEnabled: true,
    aliases: ['debug', 'trace'],
  },
  {
    key: 'remote-bridges',
    description: 'Enable local bridge and remote trigger helpers.',
    defaultEnabled: true,
    aliases: ['bridges', 'remote'],
  },
]

const TOOL_FEATURE_MAP: Array<{
  flag: RoyCodeFeatureFlag
  test: (toolName: string) => boolean
}> = [
  {
    flag: 'web-tools',
    test: toolName => toolName === 'web_search' || toolName === 'web_fetch',
  },
  {
    flag: 'magic-docs',
    test: toolName =>
      toolName === 'list_magic_docs' ||
      toolName === 'search_magic_docs' ||
      toolName === 'read_magic_doc',
  },
  {
    flag: 'github-context',
    test: toolName =>
      toolName === 'list_github_issues' ||
      toolName === 'read_github_issue' ||
      toolName === 'list_pr_comments',
  },
  {
    flag: 'mcp',
    test: toolName =>
      toolName.startsWith('list_mcp') ||
      toolName.startsWith('read_mcp') ||
      toolName.startsWith('get_mcp') ||
      toolName === 'call_mcp_tool',
  },
  {
    flag: 'subagents',
    test: toolName =>
      toolName === 'run_subagent' ||
      toolName === 'list_agents' ||
      toolName === 'read_agent',
  },
  {
    flag: 'teams',
    test: toolName =>
      toolName.startsWith('list_teams') ||
      toolName === 'get_team' ||
      toolName === 'create_team' ||
      toolName === 'run_team' ||
      toolName === 'create_team_tasks' ||
      toolName === 'list_team_messages' ||
      toolName === 'send_team_message' ||
      toolName === 'get_team_memory' ||
      toolName === 'set_team_memory' ||
      toolName === 'sync_team_memory',
  },
  {
    flag: 'worktrees',
    test: toolName =>
      toolName === 'list_worktrees' ||
      toolName === 'create_worktree' ||
      toolName === 'remove_worktree' ||
      toolName === 'inspect_worktree',
  },
  {
    flag: 'notebooks',
    test: toolName =>
      toolName.startsWith('list_notebook') ||
      toolName.startsWith('read_notebook') ||
      toolName.startsWith('edit_notebook') ||
      toolName.startsWith('add_notebook') ||
      toolName.startsWith('delete_notebook'),
  },
  {
    flag: 'lsp',
    test: toolName => toolName.startsWith('lsp_'),
  },
  {
    flag: 'remote-bridges',
    test: toolName =>
      toolName.startsWith('list_bridges') ||
      toolName.startsWith('ping_bridge') ||
      toolName.startsWith('bridge_') ||
      toolName.startsWith('list_remote_triggers') ||
      toolName.startsWith('fire_remote_trigger'),
  },
]

export function normalizeFeatureFlagOverrides(
  raw: unknown,
): Record<RoyCodeFeatureFlag, boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {} as Record<RoyCodeFeatureFlag, boolean>
  }

  const normalized = {} as Record<RoyCodeFeatureFlag, boolean>
  for (const [key, value] of Object.entries(raw)) {
    const resolved = resolveFeatureFlag(key)
    if (!resolved || typeof value !== 'boolean') {
      continue
    }
    normalized[resolved.key] = value
  }
  return normalized
}

export function listFeatureFlagDefinitions(): FeatureFlagDefinition[] {
  return [...FEATURE_FLAGS]
}

export function resolveFeatureFlag(reference: string): FeatureFlagDefinition | null {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  return (
    FEATURE_FLAGS.find(flag => flag.key === normalized) ??
    FEATURE_FLAGS.find(flag => flag.aliases?.some(alias => alias.toLowerCase() === normalized)) ??
    FEATURE_FLAGS.find(flag => flag.key.includes(normalized)) ??
    null
  )
}

export function isFeatureEnabled(
  settings: AppSettings,
  reference: RoyCodeFeatureFlag | string,
): boolean {
  const resolved =
    typeof reference === 'string' ? resolveFeatureFlag(reference) : null
  const key = (resolved?.key ?? reference) as RoyCodeFeatureFlag
  const explicit = settings.featureFlags?.[key]
  if (typeof explicit === 'boolean') {
    return explicit
  }
  return FEATURE_FLAGS.find(flag => flag.key === key)?.defaultEnabled ?? true
}

export function listFeatureFlags(settings: AppSettings): FeatureFlagState[] {
  return FEATURE_FLAGS.map(flag => ({
    ...flag,
    enabled: isFeatureEnabled(settings, flag.key),
  }))
}

export function setFeatureFlag(
  settings: AppSettings,
  reference: string,
  enabled: boolean,
): AppSettings {
  const resolved = resolveFeatureFlag(reference)
  if (!resolved) {
    throw new Error(`Unknown feature flag: ${reference}`)
  }
  return {
    ...settings,
    featureFlags: {
      ...(settings.featureFlags ?? {}),
      [resolved.key]: enabled,
    },
  }
}

export function resetFeatureFlags(settings: AppSettings): AppSettings {
  return {
    ...settings,
    featureFlags: {},
  }
}

export function isToolEnabledByFeatureFlags(
  settings: AppSettings,
  toolName: string,
): boolean {
  for (const mapping of TOOL_FEATURE_MAP) {
    if (mapping.test(toolName)) {
      return isFeatureEnabled(settings, mapping.flag)
    }
  }
  return true
}
