import type { AppSettings, AccessMode } from './types.js'

export type PolicyProfile = 'balanced' | 'strict' | 'relaxed'

export type PolicyProfileDefinition = {
  key: PolicyProfile
  description: string
  accessMode: AccessMode
  safeWriteMode: boolean
  maxAgentSteps?: number
  commandTimeoutMs?: number
  blockedTools: string[]
}

export type EffectivePolicy = {
  profile: PolicyProfile
  description: string
  accessMode: AccessMode
  safeWriteMode: boolean
  allowedTools: string[]
  blockedTools: string[]
}

const POLICY_PROFILES: PolicyProfileDefinition[] = [
  {
    key: 'balanced',
    description: 'Default RoyCode local policy: workspace mode, safe writes, full read tooling.',
    accessMode: 'workspace',
    safeWriteMode: true,
    blockedTools: [],
  },
  {
    key: 'strict',
    description: 'Read-heavy and safety-first policy with mutating or risky tools blocked.',
    accessMode: 'workspace',
    safeWriteMode: true,
    maxAgentSteps: 5,
    commandTimeoutMs: 12_000,
    blockedTools: [
      'run_command',
      'write_file',
      'replace_in_file',
      'create_worktree',
      'remove_worktree',
      'edit_notebook_cell',
      'add_notebook_cell',
      'delete_notebook_cell',
      'create_team',
      'create_team_tasks',
      'run_subagent',
      'fire_remote_trigger',
      'bridge_run_command',
      'install_marketplace_item',
    ],
  },
  {
    key: 'relaxed',
    description: 'Local power-user policy with unrestricted access and direct writes.',
    accessMode: 'unrestricted',
    safeWriteMode: false,
    maxAgentSteps: 12,
    commandTimeoutMs: 30_000,
    blockedTools: [],
  },
]

function normalizeToolList(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return [...new Set(raw.map(item => String(item).trim()).filter(Boolean))]
}

export function listPolicyProfiles(): PolicyProfileDefinition[] {
  return [...POLICY_PROFILES]
}

export function resolvePolicyProfile(reference?: string): PolicyProfileDefinition | null {
  const normalized = reference?.trim().toLowerCase() ?? ''
  if (!normalized) {
    return null
  }
  return (
    POLICY_PROFILES.find(profile => profile.key === normalized) ??
    POLICY_PROFILES.find(profile => profile.key.includes(normalized)) ??
    null
  )
}

export function getPolicyProfile(settings: AppSettings): PolicyProfileDefinition {
  return (
    resolvePolicyProfile(settings.policyProfile ?? 'balanced') ??
    POLICY_PROFILES[0]
  )
}

export function getEffectivePolicy(settings: AppSettings): EffectivePolicy {
  const profile = getPolicyProfile(settings)
  const allowedTools = normalizeToolList(settings.policyAllowedTools)
  const blockedTools = [
    ...profile.blockedTools,
    ...normalizeToolList(settings.policyBlockedTools),
  ]
  return {
    profile: profile.key,
    description: profile.description,
    accessMode: settings.accessMode,
    safeWriteMode: settings.safeWriteMode,
    allowedTools,
    blockedTools: [...new Set(blockedTools)],
  }
}

export function applyPolicyProfile(
  settings: AppSettings,
  reference: string,
): AppSettings {
  const profile = resolvePolicyProfile(reference)
  if (!profile) {
    throw new Error(`Unknown policy profile: ${reference}`)
  }

  return {
    ...settings,
    policyProfile: profile.key,
    accessMode: profile.accessMode,
    safeWriteMode: profile.safeWriteMode,
    maxAgentSteps: profile.maxAgentSteps ?? settings.maxAgentSteps,
    commandTimeoutMs: profile.commandTimeoutMs ?? settings.commandTimeoutMs,
    policyAllowedTools: [],
    policyBlockedTools: [...profile.blockedTools],
  }
}

export function setPolicyToolMode(
  settings: AppSettings,
  mode: 'allow' | 'block',
  tools: string[],
): AppSettings {
  const normalized = normalizeToolList(tools)
  if (!normalized.length) {
    return settings
  }

  if (mode === 'allow') {
    return {
      ...settings,
      policyAllowedTools: [...new Set([...(settings.policyAllowedTools ?? []), ...normalized])],
    }
  }

  return {
    ...settings,
    policyBlockedTools: [...new Set([...(settings.policyBlockedTools ?? []), ...normalized])],
  }
}

export function clearPolicyToolMode(
  settings: AppSettings,
  mode: 'allow' | 'block' | 'all' = 'all',
): AppSettings {
  if (mode === 'allow') {
    return { ...settings, policyAllowedTools: [] }
  }
  if (mode === 'block') {
    return { ...settings, policyBlockedTools: [] }
  }
  return {
    ...settings,
    policyAllowedTools: [],
    policyBlockedTools: [],
  }
}

export function isToolAllowedByPolicy(
  settings: AppSettings,
  toolName: string,
): boolean {
  const policy = getEffectivePolicy(settings)
  if (policy.allowedTools.length && !policy.allowedTools.includes(toolName)) {
    return false
  }
  return !policy.blockedTools.includes(toolName)
}
