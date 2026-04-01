import { getLocalOutputStyle, listLocalOutputStyles } from './claudeCompat.js'
import { listPluginOutputStyles } from './pluginRuntime.js'

export type OutputStyleConfig = {
  name: string
  description: string
  prompt: string
  source: 'built-in' | 'workspace-claude' | 'user-claude' | 'plugin'
  keepCodingInstructions?: boolean
}

export const DEFAULT_OUTPUT_STYLE_NAME = 'default'

const BUILTIN_OUTPUT_STYLES: Record<string, OutputStyleConfig | null> = {
  [DEFAULT_OUTPUT_STYLE_NAME]: null,
  explanatory: {
    name: 'Explanatory',
    description: 'Explain implementation choices and codebase patterns while completing the task.',
    source: 'built-in',
    keepCodingInstructions: true,
    prompt: `Provide brief educational explanations before or after meaningful code changes.

Focus on:
- why this implementation approach fits the codebase
- tradeoffs that matter here
- patterns the user can reuse elsewhere

Keep the task moving. Do not turn every answer into a tutorial.`,
  },
  learning: {
    name: 'Learning',
    description: 'Bias toward collaborative learning and explain the reasoning behind changes.',
    source: 'built-in',
    keepCodingInstructions: true,
    prompt: `Act like a collaborative coding mentor while still finishing the task.

When a design choice is important and there is time to explain, briefly outline the tradeoff.
Prefer small, concrete teaching moments over long lectures.
If the user asks for direct execution, still execute the work rather than stopping for homework.`,
  },
}

export async function listAvailableOutputStyles(
  workspaceRoot?: string,
  cwd = '.',
): Promise<Array<OutputStyleConfig | null>> {
  const [local, pluginStyles] = await Promise.all([
    listLocalOutputStyles(workspaceRoot, cwd),
    listPluginOutputStyles(),
  ])
  const styles = new Map<string, OutputStyleConfig | null>()

  for (const [key, value] of Object.entries(BUILTIN_OUTPUT_STYLES)) {
    styles.set(key.toLowerCase(), value)
  }
  for (const style of local) {
    styles.set(style.name.toLowerCase(), {
      name: style.name,
      description: style.description,
      prompt: style.prompt,
      source: style.source,
      keepCodingInstructions: style.keepCodingInstructions,
    })
  }
  for (const style of pluginStyles) {
    styles.set(style.name.toLowerCase(), {
      name: style.name,
      description: style.description,
      prompt: style.prompt,
      source: 'plugin',
      keepCodingInstructions: style.keepCodingInstructions,
    })
  }

  return [...styles.values()].filter((style, index, all) => {
    if (style === null) {
      return index === all.findIndex(item => item === null)
    }
    return index === all.findIndex(item => item?.name.toLowerCase() === style.name.toLowerCase())
  })
}

export async function getOutputStyleConfig(
  name: string | undefined,
  workspaceRoot?: string,
  cwd = '.',
): Promise<OutputStyleConfig | null> {
  const normalized = (name || DEFAULT_OUTPUT_STYLE_NAME).trim().toLowerCase()
  if (normalized === DEFAULT_OUTPUT_STYLE_NAME) {
    return null
  }

  const builtin = BUILTIN_OUTPUT_STYLES[normalized]
  if (builtin !== undefined) {
    return builtin
  }

  const local = await getLocalOutputStyle(normalized, workspaceRoot, cwd)
  if (local) {
    return {
      name: local.name,
      description: local.description,
      prompt: local.prompt,
      source: local.source,
      keepCodingInstructions: local.keepCodingInstructions,
    }
  }

  const pluginStyles = await listPluginOutputStyles()
  const pluginStyle =
    pluginStyles.find(style => style.name.toLowerCase() === normalized) ??
    pluginStyles.find(style => style.name.toLowerCase().startsWith(normalized)) ??
    pluginStyles.find(style => style.name.toLowerCase().includes(normalized))

  if (!pluginStyle) {
    return null
  }

  return {
    name: pluginStyle.name,
    description: pluginStyle.description,
    prompt: pluginStyle.prompt,
    source: 'plugin',
    keepCodingInstructions: pluginStyle.keepCodingInstructions,
  }
}
