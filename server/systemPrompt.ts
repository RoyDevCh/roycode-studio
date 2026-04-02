import type { AppSettings, ChatRequest } from './types.js'
import { getApplicableRules } from './claudeCompat.js'
import { listLocalCompatCommands } from './localCommands.js'
import { listLocalAgents } from './localAgents.js'
import { listMcpServers } from './mcp.js'
import { getOutputStyleConfig } from './outputStyles.js'
import { listPluginCommands } from './pluginRuntime.js'
import { listLocalSkills } from './skills.js'
import { listFeatureFlags } from './featureFlags.js'
import { getEffectivePolicy } from './policy.js'
import { loadWorkspaceContext } from './workspaceContext.js'

type PromptSection = {
  title: string
  body: string
}

function section(title: string, body: string | null | undefined): PromptSection | null {
  const trimmed = body?.trim()
  if (!trimmed) {
    return null
  }
  return { title, body: trimmed }
}

function renderSection(entry: PromptSection): string {
  return `## ${entry.title}\n${entry.body}`
}

function buildToolPolicy(settings: AppSettings): string {
  const policy = getEffectivePolicy(settings)
  const disabledFlags = listFeatureFlags(settings).filter(flag => !flag.enabled)
  return [
    '- RoyCode is a local coding agent with tool access. Do not claim you lack a capability when the corresponding tool exists.',
    '- Describe restrictions in terms of the current mode, local policy, permission rules, provider/tool availability, or OS-level access instead of saying the capability does not exist.',
    '- Read the relevant files before editing them.',
    '- Keep changes minimal and preserve existing style.',
    '- Prefer editing existing files over creating new ones unless the task clearly requires a new file.',
    '- When current or external information is needed, use web_search and web_fetch instead of guessing.',
    '- Use allowed_domains in web_search when the user wants official docs or a specific site.',
    '- Network access is available through web_search, web_fetch, configured MCP tools, GitHub helpers, and shell commands when those tools are enabled and permitted.',
    '- Shell and filesystem actions are available within the current OS account, subject to access mode, local policy, dangerous-command checks, and any permission workflow.',
    '- If an action needs approval or is blocked by policy, explain that specific restriction and suggest the nearest allowed path forward.',
    settings.safeWriteMode
      ? '- Safe write mode is enabled. Agent edits should be staged for approval instead of silently writing to disk.'
      : '- Safe write mode is disabled. Agent edits may be written directly to disk.',
    settings.accessMode === 'unrestricted'
      ? '- Filesystem access is unrestricted within the current OS account. Absolute paths may be used when needed.'
      : '- Filesystem access is limited to the configured workspace root.',
    ...(settings.additionalWorkspaceRoots?.length
      ? [
          `- Additional allowed directories are configured: ${settings.additionalWorkspaceRoots.join(', ')}.`,
        ]
      : []),
    '- Prefer local workspace docs before public web search when repository markdown or text documentation is likely to answer the question.',
    '- If the workspace has a GitHub origin, issue and pull-request comment tools can provide project context from discussions and review threads.',
    `- Active local policy profile: ${policy.profile}. ${policy.description}`,
    ...(policy.allowedTools.length
      ? [`- Local policy allowlist is active for these tools: ${policy.allowedTools.join(', ')}.`]
      : []),
    ...(policy.blockedTools.length
      ? [`- Local policy currently blocks these tools: ${policy.blockedTools.join(', ')}.`]
      : []),
    ...(disabledFlags.length
      ? [
          `- The following local feature flags are disabled and their related capabilities should not be used: ${disabledFlags
            .map(flag => flag.key)
            .join(', ')}.`,
        ]
      : []),
    ...(Object.keys(settings.shellEnv ?? {}).length
      ? [
          `- Persisted shell environment override keys are available to shell tools: ${Object.keys(settings.shellEnv ?? {}).sort().join(', ')}.`,
        ]
      : []),
  ].join('\n')
}

function buildTaskPolicy(): string {
  return [
    '- For complex work with multiple distinct steps, use task tools to create or inspect background tasks.',
    '- When tasks already exist, check them before creating duplicates.',
    '- Treat tasks as durable progress tracking, not as a substitute for the final user-facing answer.',
  ].join('\n')
}

function buildSkillPolicy(): string {
  return [
    '- If local skills are available and relevant, inspect them before improvising your own workflow.',
    '- Follow active local skills as higher-priority workspace guidance unless the user directly asks otherwise.',
    '- Local plugins may provide reusable markdown commands and extra skills. Inspect them when they appear relevant.',
    '- Configured MCP servers may expose extra tools, prompts, and resources for specialized workflows.',
    '- When the user references "/something" or a known workflow, prefer the skill tool before answering directly.',
  ].join('\n')
}

function buildWorkspaceInfo(settings: AppSettings, request: ChatRequest): string {
  return [
    `Workspace root: ${settings.workspaceRoot}`,
    `Additional workspace dirs: ${
      settings.additionalWorkspaceRoots?.length
        ? settings.additionalWorkspaceRoots.join(', ')
        : '(none)'
    }`,
    `Filesystem access mode: ${settings.accessMode}`,
    `Preferred cwd: ${request.cwd ?? '.'}`,
    `Model: ${request.model}`,
    `Output style: ${settings.outputStyle || 'default'}`,
    `Policy profile: ${settings.policyProfile ?? 'balanced'}`,
    `Privacy mode: ${settings.privacyMode ?? 'standard'}`,
    `Trace enabled: ${settings.traceEnabled ? 'yes' : 'no'}`,
    `Shell env override keys: ${
      Object.keys(settings.shellEnv ?? {}).length
        ? Object.keys(settings.shellEnv ?? {}).sort().join(', ')
        : '(none)'
    }`,
  ].join('\n')
}

function pushWithinBudget(lines: string[], nextLine: string, budget: number): boolean {
  const currentLength = lines.join('\n').length
  if (currentLength + nextLine.length + (lines.length > 0 ? 1 : 0) > budget) {
    return false
  }
  lines.push(nextLine)
  return true
}

async function buildAvailableSkillsSection(
  settings: AppSettings,
  request: ChatRequest,
): Promise<string> {
  const skills = (await listLocalSkills(settings.workspaceRoot, request.cwd ?? '.')).filter(
    skill => skill.userInvocable !== false,
  )
  const localCommands = (
    await listLocalCompatCommands(settings.workspaceRoot, request.cwd ?? '.')
  ).filter(command => command.userInvocable !== false)
  const pluginCommands = (await listPluginCommands()).filter(
    command => command.userInvocable !== false,
  )

  if (!skills.length && !localCommands.length && !pluginCommands.length) {
    return ''
  }

  const lines: string[] = [
    '- Use the `skill` tool when one of these matches the request.',
    '- Skill names can come from workspace `.claude/skills`, user `~/.claude/skills`, RoyCode local data skills, or local plugins.',
    '',
    'Available entries:',
  ]

  const budget = 4_000
  for (const skill of skills) {
    if (
      !pushWithinBudget(
        lines,
        `- ${skill.name}: ${skill.summary}${skill.source === 'plugin' ? ' [plugin skill]' : ''}`,
        budget,
      )
    ) {
      break
    }
  }

  if (localCommands.length) {
    pushWithinBudget(lines, '', budget)
    pushWithinBudget(lines, 'Local Claude-style commands:', budget)
    for (const command of localCommands) {
      if (
        !pushWithinBudget(
          lines,
          `- ${command.name}: ${command.summary}`,
          budget,
        )
      ) {
        break
      }
    }
  }

  if (pluginCommands.length) {
    pushWithinBudget(lines, '', budget)
    pushWithinBudget(lines, 'Plugin slash commands:', budget)
    for (const command of pluginCommands) {
      if (
        !pushWithinBudget(
          lines,
          `- ${command.name}: ${command.description}`,
          budget,
        )
      ) {
        break
      }
    }
  }

  return lines.join('\n').trim()
}

async function buildAvailableAgentsSection(
  settings: AppSettings,
  request: ChatRequest,
): Promise<string> {
  const agents = await listLocalAgents(settings.workspaceRoot, request.cwd ?? '.')
  if (!agents.length) {
    return ''
  }

  const lines: string[] = [
    '- Use the `run_subagent` tool with `agent_name` when one of these specialized local agents matches the task.',
    '- Agents can come from workspace or user `.claude/agents` directories.',
    '',
    'Available agents:',
  ]

  const budget = 2_000
  for (const agent of agents) {
    if (
      !pushWithinBudget(
        lines,
        `- ${agent.name}: ${agent.description}`,
        budget,
      )
    ) {
      break
    }
  }

  return lines.join('\n').trim()
}

async function buildMcpOverview(workspaceRoot: string): Promise<string> {
  const servers = await listMcpServers(workspaceRoot)
  if (!servers.length) {
    return ''
  }

  return servers
    .map(
      server =>
        `- ${server.name}: ${server.enabled ? 'enabled' : 'disabled'} ${server.transport === 'stdio' ? `stdio (${server.command})` : `http (${server.url})`}`,
    )
    .join('\n')
}

async function buildRuleSection(
  settings: AppSettings,
  request: ChatRequest,
): Promise<string> {
  const rules = await getApplicableRules(settings.workspaceRoot, request.cwd ?? '.')
  if (!rules.length) {
    return ''
  }

  return rules
    .map(rule =>
      [`### ${rule.name}`, `Path: ${rule.filePath}`, rule.paths?.length ? `Paths: ${rule.paths.join(', ')}` : '', '', rule.content]
        .filter(Boolean)
        .join('\n'),
    )
    .join('\n\n')
}

export async function buildEffectiveSystemPrompt(
  settings: AppSettings,
  request: ChatRequest,
): Promise<string> {
  const workspaceContext = await loadWorkspaceContext(
    settings.workspaceRoot,
    settings.accessMode,
    request.cwd ?? '.',
  )
  const availableSkills = await buildAvailableSkillsSection(settings, request)
  const availableAgents = await buildAvailableAgentsSection(settings, request)
  const mcpOverview = await buildMcpOverview(settings.workspaceRoot)
  const ruleSection = await buildRuleSection(settings, request)
  const outputStyle = await getOutputStyleConfig(
    settings.outputStyle,
    settings.workspaceRoot,
    request.cwd ?? '.',
  )

  const instructionSection =
    workspaceContext.instructionFiles.length > 0
      ? workspaceContext.instructionFiles
          .map(file => `### ${file.label}\nPath: ${file.path}\n\n${file.content}`)
          .join('\n\n')
      : ''

  const addenda = (request.systemAddenda || []).filter(item => item.trim())

  const sections = [
    section('Base Identity', settings.systemPrompt),
    section('Runtime Context', buildWorkspaceInfo(settings, request)),
    section('Tool Policy', buildToolPolicy(settings)),
    section('Task Policy', buildTaskPolicy()),
    section('Skill Policy', buildSkillPolicy()),
    section('Available Skills and Slash Commands', availableSkills),
    section('Available Local Agents', availableAgents),
    section('Configured MCP Servers', mcpOverview),
    section(
      'Output Style',
      outputStyle
        ? `Style: ${outputStyle.name}\nSource: ${outputStyle.source}\n\n${outputStyle.prompt}`
        : '',
    ),
    section('Workspace Instructions', instructionSection),
    section('Workspace Rules', ruleSection),
    section(
      'Workspace Memory',
      `${workspaceContext.workspaceMemory.content}\n\nMemory file: ${workspaceContext.workspaceMemory.path}`,
    ),
    section('Extra System Addenda', addenda.join('\n\n')),
    section(
      'Completion Policy',
      'After you finish, summarize the result, user-visible impact, and any important next step clearly.',
    ),
  ].filter(Boolean) as PromptSection[]

  return sections.map(renderSection).join('\n\n')
}
