import type { AgentMessage, ExecutionMode } from './types.js'

export type PromptSuggestionContext = {
  workspaceRoot: string
  cwd: string
  executionMode: ExecutionMode
  activeSkills: string[]
  briefMode: boolean
  pendingAttachments: number
  compactSummaries: number
  messages: AgentMessage[]
}

function extractText(message: AgentMessage | undefined): string {
  if (!message) {
    return ''
  }
  if (typeof message.content === 'string') {
    return message.content
  }
  return message.content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')
}

function pushUnique(target: string[], value: string): void {
  const trimmed = value.trim()
  if (!trimmed || target.includes(trimmed)) {
    return
  }
  target.push(trimmed)
}

export function buildPromptSuggestions(context: PromptSuggestionContext): string[] {
  const userMessages = context.messages.filter(message => message.role === 'user')
  const assistantMessages = context.messages.filter(
    message => message.role === 'assistant',
  )
  const lastUser = extractText(userMessages.at(-1))
  const lastAssistant = extractText(assistantMessages.at(-1))
  const suggestions: string[] = []

  if (!context.messages.length) {
    pushUnique(
      suggestions,
      'Summarize this workspace architecture and list the top implementation risks.',
    )
    pushUnique(
      suggestions,
      'Inspect the project entry points, build commands, and the most important local workflows.',
    )
    pushUnique(
      suggestions,
      'Review the current repository state and suggest the best next engineering task.',
    )
    pushUnique(
      suggestions,
      `Search the workspace rooted at ${context.workspaceRoot} and identify the main subsystems worth understanding first.`,
    )
    return suggestions.slice(0, 4)
  }

  if (context.executionMode === 'plan') {
    pushUnique(
      suggestions,
      'Turn the current plan into a numbered checklist with dependencies and risk notes.',
    )
    pushUnique(
      suggestions,
      'Identify the smallest safe first implementation step without making changes yet.',
    )
  }

  if (context.compactSummaries > 0) {
    pushUnique(
      suggestions,
      'Refresh the compact summary with what changed recently and call out any new risks.',
    )
  }

  if (context.pendingAttachments > 0) {
    pushUnique(
      suggestions,
      'Use the attached files as context and point out the most important follow-up change.',
    )
  }

  if (context.activeSkills.length) {
    pushUnique(
      suggestions,
      `Apply the active skills (${context.activeSkills.join(', ')}) to the next recommended task.`,
    )
  }

  if (/test|spec|verify|assert/i.test(lastAssistant)) {
    pushUnique(
      suggestions,
      'Write or update the minimal tests needed to verify the change you just proposed.',
    )
  }

  if (/fix|change|patch|diff|rename|refactor/i.test(lastAssistant)) {
    pushUnique(
      suggestions,
      'Turn that proposal into a concrete implementation plan with exact files and validation steps.',
    )
    pushUnique(
      suggestions,
      'Review the likely regressions from that change and suggest quick smoke tests.',
    )
  }

  if (lastUser) {
    pushUnique(
      suggestions,
      `Continue the last request by turning "${lastUser.slice(0, 80)}" into an actionable checklist.`,
    )
  }

  if (lastAssistant) {
    pushUnique(
      suggestions,
      `Critique the last answer for gaps, edge cases, and missing verification steps.`,
    )
  }

  pushUnique(
    suggestions,
    `Search ${context.cwd} for the files most relevant to the current thread and summarize the next move.`,
  )
  pushUnique(
    suggestions,
    context.briefMode
      ? 'Give me the shortest next-step recommendation with one concrete action.'
      : 'Recommend the strongest next step and explain why it is the highest-value move now.',
  )

  return suggestions.slice(0, 6)
}
