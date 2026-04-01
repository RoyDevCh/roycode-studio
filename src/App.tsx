import {
  type ClipboardEvent as ReactClipboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { buildLineDiff } from './lib/diff'
import type {
  AccessMode,
  AgentStreamEvent,
  ChatMessage,
  DraftPatchPreview,
  FileNode,
  GitDiffPayload,
  GitStatusPayload,
  PendingChange,
  PromptAttachment,
  ProviderPreset,
  ProviderPublic,
  PublicSettings,
  RequestMessageContentPart,
  SessionState,
  TerminalEntry,
  ToolEvent,
  WorkspaceFilePayload,
} from './types'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('powershell', powershell)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

const SESSION_STORAGE_KEY = 'roycode-studio-sessions-v1'
const THEME_STORAGE_KEY = 'roycode-studio-theme-v1'
const WORKSPACE_PRESET_STORAGE_KEY = 'roycode-studio-workspaces-v1'
const LAYOUT_STORAGE_KEY = 'roycode-studio-layout-v1'
const TOOL_PENDING_OUTPUT = 'Running...'
const MAX_TEXT_ATTACHMENT_BYTES = 180_000
const MAX_IMAGE_ATTACHMENT_BYTES = 1_500_000
const MAX_ATTACHMENT_CHARS = 12_000
const MAX_ATTACHMENTS_PER_PROMPT = 5
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'js',
  'jsx',
  'ts',
  'tsx',
  'css',
  'scss',
  'html',
  'xml',
  'yml',
  'yaml',
  'py',
  'java',
  'go',
  'rs',
  'sql',
  'sh',
  'ps1',
  'c',
  'cpp',
  'h',
  'hpp',
  'ini',
  'toml',
  'log',
])

type ProviderDraft = ProviderPublic & {
  apiKeyInput: string
  modelsText: string
}

type ThemeMode = 'light' | 'dark'

type WorkspaceTab =
  | 'projects'
  | 'git'
  | 'files'
  | 'editor'
  | 'changes'
  | 'terminal'
  | 'providers'
  | 'settings'

type MessageSegment =
  | {
      type: 'text'
      content: string
    }
  | {
      type: 'code'
      language: string
      code: string
    }

type MarkdownBlock =
  | {
      type: 'heading'
      level: 1 | 2 | 3 | 4 | 5 | 6
      content: string
    }
  | {
      type: 'paragraph'
      content: string
    }
  | {
      type: 'blockquote'
      lines: string[]
    }
  | {
      type: 'unordered-list'
      items: string[]
    }
  | {
      type: 'ordered-list'
      items: string[]
    }
  | {
      type: 'table'
      header: string[]
      rows: string[][]
    }

type SessionArchive = {
  version: number
  exportedAt: string
  activeSessionId: string
  sessions: Array<Partial<SessionState>>
}

type WorkspacePreset = {
  id: string
  name: string
  root: string
  lastUsedAt: string
  favorite?: boolean
}

type LayoutPrefs = {
  sidebarCollapsed: boolean
  dockCollapsed: boolean
  dockWidth: number
}

type ProjectRailView = 'all' | 'favorites' | 'recent'

type DiffChunk = {
  id: string
  lines: ReturnType<typeof buildLineDiff>
  originalStartIndex: number
  originalEndIndexExclusive: number
  replacementLines: string[]
  additions: number
  removals: number
}

type CommandPaletteItem =
  | {
      id: string
      section: 'Action'
      label: string
      hint: string
      action:
        | 'new-chat-current'
        | 'save-current-project'
        | 'toggle-sidebar'
        | 'toggle-dock'
        | 'refresh-git'
    }
  | {
      id: string
      section: 'Workspace'
      label: string
      hint: string
      action: 'tab'
      tab: WorkspaceTab
    }
  | {
      id: string
      section: 'Project'
      label: string
      hint: string
      action: 'project-open' | 'project-new-chat'
      root: string
    }
  | {
      id: string
      section: 'Chat'
      label: string
      hint: string
      action: 'session-open'
      root: string
      sessionId: string
    }

type SlashCommand =
  | {
      id: string
      label: string
      description: string
      prompt: string
    }
  | {
      id: string
      label: string
      description: string
      action: 'open-git' | 'refresh-git'
    }

const WORKSPACE_TAB_ITEMS: Array<{ id: WorkspaceTab; label: string }> = [
  { id: 'projects', label: 'Workspaces' },
  { id: 'git', label: 'Git' },
  { id: 'files', label: 'Explorer' },
  { id: 'editor', label: 'Editor' },
  { id: 'changes', label: 'Reviews' },
  { id: 'terminal', label: 'Shell' },
  { id: 'providers', label: 'Models' },
  { id: 'settings', label: 'Settings' },
]

const DESKTOP_OPEN_GIT_SENTINEL = '__ROYCODE_DESKTOP_OPEN_GIT__'

const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'review',
    label: '/review',
    description: 'Run a code-review style request focused on bugs and risks.',
    prompt:
      'Review this workspace like a code reviewer. Focus on bugs, risks, regressions, and missing tests. Start with findings ordered by severity and include concrete file references.',
  },
  {
    id: 'fix',
    label: '/fix',
    description: 'Ask the assistant to inspect files first and make a safe targeted fix.',
    prompt:
      'Inspect the relevant files, identify the root cause, then make the smallest safe fix and explain what changed.',
  },
  {
    id: 'explain',
    label: '/explain',
    description: 'Explain the current file or area in practical engineering terms.',
    prompt:
      'Explain the current file or relevant code path, highlight the most important implementation details, and point out likely maintenance risks.',
  },
  {
    id: 'plan',
    label: '/plan',
    description: 'Generate an implementation plan before editing.',
    prompt:
      'Read the relevant code, then produce a concise implementation plan with tradeoffs, risks, and the first step you recommend.',
  },
  {
    id: 'test',
    label: '/test',
    description: 'Prepare a test/debugging oriented request.',
    prompt:
      'Inspect the workspace and tell me the safest next command or test to run, then help interpret the result.',
  },
  {
    id: 'git',
    label: '/git',
    description: 'Open the Git panel for status, diff, staging, and commit work.',
    action: 'open-git' as const,
  },
  {
    id: 'status',
    label: '/status',
    description: 'Refresh the Git status panel immediately.',
    action: 'refresh-git' as const,
  },
]

const PROMPT_SUGGESTIONS = [
  'Review this project structure and tell me what matters most first.',
  'Open the current file and help me refactor it safely.',
  'Find likely bugs in this workspace and prioritize them.',
  'Implement a small feature and explain the changed files.',
]

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'dark'
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') {
    return saved
  }
  return 'dark'
}

function getWorkspaceLabel(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? root
}

function isAbsoluteDesktopPath(filePath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(filePath) || /^\\\\/.test(filePath) || filePath.startsWith('/')
}

function pathJoinForDesktop(root: string, relativePath: string): string {
  if (isAbsoluteDesktopPath(relativePath)) {
    return relativePath.replace(/\//g, '\\')
  }
  const normalizedRoot = root.replace(/[\\/]+$/, '')
  const normalizedRelative = relativePath.replace(/[/\\]+/g, '\\')
  return `${normalizedRoot}\\${normalizedRelative}`
}

function restoreWorkspacePresets(): WorkspacePreset[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_PRESET_STORAGE_KEY)
    if (!raw) {
      return []
    }

    const parsed = JSON.parse(raw) as WorkspacePreset[]
    return Array.isArray(parsed)
      ? parsed.filter(item => item?.root?.trim()).map(item => ({
          id: item.id || createId(),
          name: item.name?.trim() || getWorkspaceLabel(item.root),
          root: item.root.trim(),
          lastUsedAt: item.lastUsedAt || new Date().toISOString(),
          favorite: Boolean(item.favorite),
        }))
      : []
  } catch {
    return []
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function restoreLayoutPrefs(): LayoutPrefs {
  if (typeof window === 'undefined') {
    return {
      sidebarCollapsed: false,
      dockCollapsed: false,
      dockWidth: 420,
    }
  }

  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) {
      return {
        sidebarCollapsed: false,
        dockCollapsed: false,
        dockWidth: 420,
      }
    }

    const parsed = JSON.parse(raw) as Partial<LayoutPrefs>
    return {
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
      dockCollapsed: Boolean(parsed.dockCollapsed),
      dockWidth: clampNumber(Number(parsed.dockWidth) || 420, 320, 720),
    }
  } catch {
    return {
      sidebarCollapsed: false,
      dockCollapsed: false,
      dockWidth: 420,
    }
  }
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function createMessage(
  role: 'user' | 'assistant',
  content: string,
  attachments: PromptAttachment[] = [],
  pending = false,
): ChatMessage {
  return {
    id: createId(),
    role,
    content,
    attachments,
    pending,
    toolEvents: [],
  }
}

function createDefaultSession(
  providerId: string,
  model: string,
  title = 'New Session',
  workspaceRoot = '',
): SessionState {
  return {
    id: createId(),
    title,
    workspaceRoot,
    pinned: false,
    archived: false,
    tags: [],
    providerId,
    model,
    prompt: '',
    promptAttachments: [],
    messages: [
      createMessage(
        'assistant',
        'Ready when you are. Ask me to chat, inspect files, run commands, or help edit code.',
      ),
    ],
    draftPatch: null,
    selectedFile: '',
    fileContent: '',
    loadedFileContent: '',
    diskFileContent: '',
    terminalCommand: '',
    terminalCwd: '.',
    terminalHistory: [],
  }
}

function mapProviders(providers: ProviderPublic[]): Record<string, ProviderDraft> {
  return Object.fromEntries(
    providers.map(provider => [
      provider.id,
      {
        ...provider,
        apiKeyInput: '',
        modelsText: provider.models.join('\n'),
      },
    ]),
  )
}

function parseModelsText(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

function normalizeSessionTags(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map(item => item.trim()).filter(Boolean))]
  }

  if (typeof value !== 'string') {
    return []
  }

  return [...new Set(value.split(/[,\n]/).map(item => item.trim()).filter(Boolean))]
}

function normalizeAttachment(
  attachment: Partial<PromptAttachment> | null | undefined,
): PromptAttachment | null {
  if (!attachment?.name) {
    return null
  }

  if (attachment.kind === 'image') {
    if (typeof attachment.imageUrl !== 'string' || !attachment.imageUrl.trim()) {
      return null
    }

    return {
      id: attachment.id || createId(),
      kind: 'image',
      name: attachment.name.trim(),
      mimeType: attachment.mimeType?.trim() || undefined,
      content: typeof attachment.content === 'string' ? attachment.content : '',
      imageUrl: attachment.imageUrl,
      detail:
        attachment.detail === 'low' || attachment.detail === 'high'
          ? attachment.detail
          : 'auto',
      truncated: false,
    }
  }

  if (typeof attachment.content !== 'string') {
    return null
  }

  return {
    id: attachment.id || createId(),
    kind: attachment.kind === 'workspace-file' ? 'workspace-file' : 'local-file',
    name: attachment.name.trim(),
    path: attachment.path?.trim() || undefined,
    mimeType: attachment.mimeType?.trim() || undefined,
    content: attachment.content,
    truncated: Boolean(attachment.truncated),
  }
}

function normalizeAttachments(
  attachments: Array<Partial<PromptAttachment>> | undefined,
): PromptAttachment[] {
  if (!Array.isArray(attachments)) {
    return []
  }

  return attachments
    .map(attachment => normalizeAttachment(attachment))
    .filter((attachment): attachment is PromptAttachment => Boolean(attachment))
}

function trimAttachmentContent(content: string): {
  content: string
  truncated: boolean
} {
  if (content.length <= MAX_ATTACHMENT_CHARS) {
    return {
      content,
      truncated: false,
    }
  }

  return {
    content: `${content.slice(0, MAX_ATTACHMENT_CHARS)}\n...[truncated]`,
    truncated: true,
  }
}

function buildAttachmentPromptContext(attachments: PromptAttachment[]): string {
  const textAttachments = attachments.filter(attachment => attachment.kind !== 'image')
  if (!textAttachments.length) {
    return ''
  }

  const blocks = textAttachments.map(attachment => {
    const header = [
      `name=${attachment.name}`,
      attachment.path ? `path=${attachment.path}` : '',
      attachment.truncated ? 'truncated=true' : '',
    ]
      .filter(Boolean)
      .join(', ')

    return [`[Attachment: ${header}]`, attachment.content].join('\n')
  })

  return `\n\nAttached context:\n${blocks.join('\n\n')}`
}

function buildMessageContentForRequest(
  message: Pick<ChatMessage, 'content' | 'attachments'>,
): string | RequestMessageContentPart[] {
  const attachments = message.attachments ?? []
  const imageAttachments = attachments.filter(
    (attachment): attachment is PromptAttachment & { kind: 'image'; imageUrl: string } =>
      attachment.kind === 'image' && Boolean(attachment.imageUrl),
  )
  const textContent = `${message.content}${buildAttachmentPromptContext(attachments)}`.trim()

  if (!imageAttachments.length) {
    return textContent
  }

  const parts: RequestMessageContentPart[] = [
    {
      type: 'text',
      text: textContent || 'Use the attached image context for this request.',
    },
  ]

  for (const attachment of imageAttachments) {
    parts.push({
      type: 'image',
      imageUrl: attachment.imageUrl,
      mimeType: attachment.mimeType,
      detail: attachment.detail ?? 'auto',
    })
  }

  return parts
}

function isLikelyTextAttachment(file: File): boolean {
  if (file.type.startsWith('text/')) {
    return true
  }

  if (
    /(json|xml|javascript|typescript|yaml|sql|markdown)/i.test(file.type) ||
    file.type === 'application/x-sh' ||
    file.type === 'application/x-powershell'
  ) {
    return true
  }

  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : ''
  return Boolean(extension && TEXT_ATTACHMENT_EXTENSIONS.has(extension))
}

function isImageAttachment(file: File): boolean {
  return file.type.startsWith('image/')
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  const output: FileNode[] = []

  function walk(items: FileNode[]) {
    for (const item of items) {
      if (item.type === 'file') {
        output.push(item)
      }
      if (item.children?.length) {
        walk(item.children)
      }
    }
  }

  walk(nodes)
  return output.sort((left, right) => left.path.localeCompare(right.path))
}

function appendToolEvent(message: ChatMessage, event: ToolEvent): ChatMessage {
  return {
    ...message,
    toolEvents: [...(message.toolEvents ?? []), event],
  }
}

function resolveToolResult(
  message: ChatMessage,
  event: Pick<ToolEvent, 'name' | 'output'>,
): ChatMessage {
  const toolEvents = [...(message.toolEvents ?? [])]
  const targetIndex = [...toolEvents]
    .reverse()
    .findIndex(item => item.name === event.name && item.output === TOOL_PENDING_OUTPUT)

  if (targetIndex >= 0) {
    const actualIndex = toolEvents.length - targetIndex - 1
    toolEvents[actualIndex] = {
      ...toolEvents[actualIndex],
      output: event.output,
    }
  } else {
    toolEvents.push({
      name: event.name,
      input: '',
      output: event.output,
    })
  }

  return {
    ...message,
    toolEvents,
  }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('zh-CN', { hour12: false })
}

function summarizeDiffLines(lines: ReturnType<typeof buildLineDiff>): {
  additions: number
  removals: number
  changes: number
} {
  const additions = lines.filter(item => item.type === 'add').length
  const removals = lines.filter(item => item.type === 'remove').length
  return {
    additions,
    removals,
    changes: additions + removals,
  }
}

function splitPatchLines(content: string): string[] {
  if (!content) {
    return []
  }
  return content.replace(/\r\n/g, '\n').split('\n')
}

function buildDiffChunks(
  originalContent: string,
  nextContent: string,
  contextWindow = 2,
): DiffChunk[] {
  const lines = buildLineDiff(originalContent, nextContent)
  const chunks: DiffChunk[] = []
  let cursor = 0
  let chunkIndex = 0

  while (cursor < lines.length) {
    if (lines[cursor]!.type === 'context') {
      cursor += 1
      continue
    }

    const changeStart = cursor
    while (cursor < lines.length && lines[cursor]!.type !== 'context') {
      cursor += 1
    }
    const changeEnd = cursor - 1
    const changedLines = lines.slice(changeStart, changeEnd + 1)
    const leftNumbers = changedLines
      .filter(line => line.leftNumber !== undefined)
      .map(line => line.leftNumber as number)
    const previousContextLine = [...lines.slice(0, changeStart)]
      .reverse()
      .find(line => line.leftNumber !== undefined)
    const originalStartIndex =
      leftNumbers[0] !== undefined ? leftNumbers[0] - 1 : (previousContextLine?.leftNumber ?? 0)
    const originalEndIndexExclusive =
      leftNumbers[leftNumbers.length - 1] !== undefined
        ? leftNumbers[leftNumbers.length - 1]!
        : originalStartIndex

    chunks.push({
      id: `chunk-${chunkIndex + 1}`,
      lines: lines.slice(
        Math.max(0, changeStart - contextWindow),
        Math.min(lines.length, changeEnd + contextWindow + 1),
      ),
      originalStartIndex,
      originalEndIndexExclusive,
      replacementLines: changedLines
        .filter(line => line.type === 'add')
        .map(line => line.text),
      additions: changedLines.filter(line => line.type === 'add').length,
      removals: changedLines.filter(line => line.type === 'remove').length,
    })
    chunkIndex += 1
  }

  return chunks
}

function applyDiffChunkToContent(originalContent: string, chunk: DiffChunk): string {
  const originalLines = splitPatchLines(originalContent)
  const nextLines = [
    ...originalLines.slice(0, chunk.originalStartIndex),
    ...chunk.replacementLines,
    ...originalLines.slice(chunk.originalEndIndexExclusive),
  ]
  return nextLines.join('\n')
}

function applyDiffChunksToContent(originalContent: string, chunks: DiffChunk[]): string {
  const nextLines = splitPatchLines(originalContent)
  const sortedChunks = [...chunks].sort(
    (left, right) =>
      left.originalStartIndex - right.originalStartIndex ||
      left.originalEndIndexExclusive - right.originalEndIndexExclusive,
  )
  let offset = 0

  for (const chunk of sortedChunks) {
    const start = Math.max(0, chunk.originalStartIndex + offset)
    const end = Math.max(start, chunk.originalEndIndexExclusive + offset)
    nextLines.splice(start, end - start, ...chunk.replacementLines)
    offset +=
      chunk.replacementLines.length -
      (chunk.originalEndIndexExclusive - chunk.originalStartIndex)
  }

  return nextLines.join('\n')
}

function getSessionGroupKey(session: Pick<SessionState, 'pinned' | 'archived'>):
  | 'pinned'
  | 'recent'
  | 'archived' {
  if (session.archived) {
    return 'archived'
  }
  if (session.pinned) {
    return 'pinned'
  }
  return 'recent'
}

function getSessionPreview(session: SessionState): string {
  const lastMeaningful = [...session.messages]
    .reverse()
    .find(message => message.content.trim().length > 0)
  if (!lastMeaningful) {
    return 'Ready for a new prompt'
  }
  return lastMeaningful.content.replace(/\s+/g, ' ').slice(0, 72)
}

function trimSegment(value: string): string {
  return value.replace(/^\n+|\n+$/g, '')
}

function parseMessageContent(content: string): MessageSegment[] {
  if (!content.trim()) {
    return []
  }

  const segments: MessageSegment[] = []
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g
  let lastIndex = 0

  for (const match of content.matchAll(fencePattern)) {
    const block = match[0]
    const rawLanguage = match[1] ?? ''
    const rawCode = match[2] ?? ''
    const index = match.index ?? 0
    const leading = trimSegment(content.slice(lastIndex, index))

    if (leading) {
      segments.push({
        type: 'text',
        content: leading,
      })
    }

    segments.push({
      type: 'code',
      language: rawLanguage.trim(),
      code: rawCode.replace(/^\n/, '').replace(/\n$/, ''),
    })

    lastIndex = index + block.length
  }

  const trailing = trimSegment(content.slice(lastIndex))
  if (trailing) {
    segments.push({
      type: 'text',
      content: trailing,
    })
  }

  return segments.length
    ? segments
    : [
        {
          type: 'text',
          content,
        },
      ]
}

function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim())
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map(cell => cell.trim())
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  const isSpecialStart = (line: string, nextLine?: string) =>
    /^#{1,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    (line.includes('|') && Boolean(nextLine && isTableSeparator(nextLine)))

  while (index < lines.length) {
    const line = lines[index]!.trimEnd()
    const nextLine = lines[index + 1]

    if (!line.trim()) {
      index += 1
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/)
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        content: headingMatch[2].trim(),
      })
      index += 1
      continue
    }

    if (line.includes('|') && nextLine && isTableSeparator(nextLine)) {
      const header = splitTableRow(line)
      const rows: string[][] = []
      index += 2

      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(splitTableRow(lines[index]!))
        index += 1
      }

      blocks.push({
        type: 'table',
        header,
        rows,
      })
      continue
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index]!.trim())) {
        quoteLines.push(lines[index]!.trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({
        type: 'blockquote',
        lines: quoteLines,
      })
      continue
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^[-*]\s+/, ''))
        index += 1
      }
      blocks.push({
        type: 'unordered-list',
        items,
      })
      continue
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index]!.trim())) {
        items.push(lines[index]!.trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push({
        type: 'ordered-list',
        items,
      })
      continue
    }

    const paragraphLines: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const current = lines[index]!.trimEnd()
      const upcoming = lines[index + 1]
      if (!current.trim() || isSpecialStart(current.trim(), upcoming?.trimEnd())) {
        break
      }
      paragraphLines.push(current.trim())
      index += 1
    }

    blocks.push({
      type: 'paragraph',
      content: paragraphLines.join('\n'),
    })
  }

  return blocks.length
    ? blocks
    : [
        {
          type: 'paragraph',
          content,
        },
      ]
}

function renderInlineMarkdown(content: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern =
    /(`([^`]+)`)|(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g
  let lastIndex = 0

  for (const match of content.matchAll(pattern)) {
    const matchText = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      parts.push(content.slice(lastIndex, index))
    }

    if (match[2]) {
      parts.push(
        <code key={`${keyPrefix}-code-${index}`} className="markdown-inline-code">
          {match[2]}
        </code>,
      )
    } else if (match[4] && match[5]) {
      parts.push(
        <a
          key={`${keyPrefix}-link-${index}`}
          className="markdown-link"
          href={match[5]}
          target="_blank"
          rel="noreferrer"
        >
          {match[4]}
        </a>,
      )
    } else if (match[7]) {
      parts.push(
        <strong key={`${keyPrefix}-strong-${index}`} className="markdown-strong">
          {match[7]}
        </strong>,
      )
    } else if (match[9]) {
      parts.push(
        <em key={`${keyPrefix}-em-${index}`} className="markdown-emphasis">
          {match[9]}
        </em>,
      )
    } else if (matchText) {
      parts.push(matchText)
    }

    lastIndex = index + matchText.length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length ? parts : [content]
}

function renderMarkdownSegment(content: string, keyPrefix: string): ReactNode[] {
  return parseMarkdownBlocks(content).map((block, blockIndex) => {
    const blockKey = `${keyPrefix}-${block.type}-${blockIndex}`

    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}` as const
        return (
          <Tag key={blockKey} className={`markdown-heading markdown-heading-${block.level}`}>
            {renderInlineMarkdown(block.content, blockKey)}
          </Tag>
        )
      }
      case 'unordered-list':
        return (
          <ul key={blockKey} className="markdown-list markdown-list-unordered">
            {block.items.map((item, itemIndex) => (
              <li key={`${blockKey}-item-${itemIndex}`}>
                {renderInlineMarkdown(item, `${blockKey}-item-${itemIndex}`)}
              </li>
            ))}
          </ul>
        )
      case 'ordered-list':
        return (
          <ol key={blockKey} className="markdown-list markdown-list-ordered">
            {block.items.map((item, itemIndex) => (
              <li key={`${blockKey}-item-${itemIndex}`}>
                {renderInlineMarkdown(item, `${blockKey}-item-${itemIndex}`)}
              </li>
            ))}
          </ol>
        )
      case 'blockquote':
        return (
          <blockquote key={blockKey} className="markdown-blockquote">
            {block.lines.map((line, lineIndex) => (
              <p key={`${blockKey}-line-${lineIndex}`} className="markdown-quote-line">
                {renderInlineMarkdown(line, `${blockKey}-line-${lineIndex}`)}
              </p>
            ))}
          </blockquote>
        )
      case 'table':
        return (
          <div key={blockKey} className="markdown-table-wrap">
            <table className="markdown-table">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={`${blockKey}-head-${cellIndex}`}>
                      {renderInlineMarkdown(cell, `${blockKey}-head-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${blockKey}-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td key={`${blockKey}-row-${rowIndex}-cell-${cellIndex}`}>
                        {renderInlineMarkdown(
                          cell,
                          `${blockKey}-row-${rowIndex}-cell-${cellIndex}`,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      case 'paragraph':
      default:
        return (
          <p key={blockKey} className="message-paragraph markdown-paragraph">
            {renderInlineMarkdown(block.content, blockKey)}
          </p>
        )
    }
  })
}

function normalizeCodeLanguage(language: string): string | undefined {
  const value = language.trim().toLowerCase()
  if (!value) {
    return undefined
  }

  const aliasMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    pwsh: 'powershell',
    py: 'python',
    md: 'markdown',
    yml: 'yaml',
    html: 'xml',
  }

  return aliasMap[value] ?? value
}

function getHighlightedCodeLines(code: string, language: string): string[] {
  const normalizedCode = code.replace(/\r\n/g, '\n')
  const normalizedLanguage = normalizeCodeLanguage(language)

  try {
    if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
      return hljs
        .highlight(normalizedCode, {
          language: normalizedLanguage,
          ignoreIllegals: true,
        })
        .value.split('\n')
    }

    return hljs.highlightAuto(normalizedCode).value.split('\n')
  } catch {
    return normalizedCode
      .split('\n')
      .map(line =>
        line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;'),
      )
  }
}

function upsertWorkspacePreset(
  presets: WorkspacePreset[],
  root: string,
  name = getWorkspaceLabel(root),
): WorkspacePreset[] {
  const normalizedRoot = root.trim()
  if (!normalizedRoot) {
    return presets
  }

  const existingIndex = presets.findIndex(
    item => item.root.toLowerCase() === normalizedRoot.toLowerCase(),
  )
  const nextPreset: WorkspacePreset = {
    id: existingIndex >= 0 ? presets[existingIndex]!.id : createId(),
    name: name.trim() || getWorkspaceLabel(normalizedRoot),
    root: normalizedRoot,
    lastUsedAt: new Date().toISOString(),
    favorite: existingIndex >= 0 ? Boolean(presets[existingIndex]!.favorite) : false,
  }

  if (existingIndex >= 0) {
    return presets.map((preset, index) => (index === existingIndex ? nextPreset : preset))
  }

  return [nextPreset, ...presets]
}

async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    try {
      const payload = (await response.json()) as { error?: string }
      throw new Error(payload.error ?? `Request failed: ${response.status}`)
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error(`Request failed: ${response.status}`)
    }
  }

  return (await response.json()) as T
}

async function readNdjsonStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  if (!response.ok) {
    try {
      const payload = (await response.json()) as { error?: string }
      throw new Error(payload.error ?? `Stream failed: ${response.status}`)
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new Error(`Stream failed: ${response.status}`)
    }
  }

  if (!response.body) {
    throw new Error('Streaming is not supported in this browser')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).trim()
      buffer = buffer.slice(newlineIndex + 1)
      if (line) {
        onEvent(JSON.parse(line) as AgentStreamEvent)
      }
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const tail = buffer.trim()
  if (tail) {
    onEvent(JSON.parse(tail) as AgentStreamEvent)
  }
}

function normalizeSession(
  rawSession: Partial<SessionState>,
  settings: PublicSettings,
): SessionState {
  const provider =
    settings.providers.find(item => item.id === rawSession.providerId) ??
    settings.providers.find(item => item.id === settings.selectedProviderId) ??
    settings.providers[0]
  const models = provider?.models ?? []
  const fallbackModel =
    provider?.defaultModel ?? models[0] ?? settings.selectedModel ?? ''
  const model =
    rawSession.model && models.includes(rawSession.model)
      ? rawSession.model
      : fallbackModel
  const base = createDefaultSession(
    provider?.id ?? '',
    model,
    rawSession.title?.trim() || 'New Session',
    rawSession.workspaceRoot?.trim() || settings.workspaceRoot,
  )

  return {
    ...base,
    ...rawSession,
    workspaceRoot: rawSession.workspaceRoot?.trim() || settings.workspaceRoot,
    pinned: Boolean(rawSession.pinned),
    archived: Boolean(rawSession.archived),
    tags: normalizeSessionTags(rawSession.tags),
    providerId: provider?.id ?? base.providerId,
    model,
    prompt: rawSession.prompt ?? '',
    promptAttachments: normalizeAttachments(rawSession.promptAttachments),
    draftPatch: rawSession.draftPatch
      ? {
          path: rawSession.draftPatch.path ?? '',
          content: rawSession.draftPatch.content ?? '',
          sourceLabel: rawSession.draftPatch.sourceLabel ?? 'Draft patch',
          createdAt: rawSession.draftPatch.createdAt ?? new Date().toISOString(),
        }
      : null,
    selectedFile: rawSession.selectedFile ?? '',
    fileContent: rawSession.fileContent ?? '',
    loadedFileContent: rawSession.loadedFileContent ?? '',
    diskFileContent: rawSession.diskFileContent ?? '',
    terminalCommand: rawSession.terminalCommand ?? '',
    terminalCwd: rawSession.terminalCwd?.trim() || '.',
    messages: Array.isArray(rawSession.messages)
      ? rawSession.messages.map(message => ({
          id: message.id || createId(),
          role: message.role === 'user' ? 'user' : 'assistant',
          content: message.content ?? '',
          attachments: normalizeAttachments(message.attachments),
          pending: Boolean(message.pending),
          toolEvents: [...(message.toolEvents ?? [])],
        }))
      : base.messages,
    terminalHistory: Array.isArray(rawSession.terminalHistory)
      ? rawSession.terminalHistory
      : [],
  }
}

function ensureWorkspaceSessions(
  sessions: SessionState[],
  settings: PublicSettings,
  defaultProviderId: string,
  defaultModel: string,
): SessionState[] {
  const hasCurrentWorkspace = sessions.some(
    session => session.workspaceRoot === settings.workspaceRoot,
  )
  if (hasCurrentWorkspace) {
    return sessions
  }
  return [
    ...sessions,
    createDefaultSession(defaultProviderId, defaultModel, 'New Session', settings.workspaceRoot),
  ]
}

function restoreSessions(
  defaultProviderId: string,
  defaultModel: string,
  workspaceRoot: string,
): {
  sessions: SessionState[]
  activeSessionId: string
} {
  const fallbackSession = createDefaultSession(defaultProviderId, defaultModel, 'New Session', workspaceRoot)

  if (typeof window === 'undefined') {
    return {
      sessions: [fallbackSession],
      activeSessionId: fallbackSession.id,
    }
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) {
      return {
        sessions: [fallbackSession],
        activeSessionId: fallbackSession.id,
      }
    }

    const parsed = JSON.parse(raw) as {
      sessions?: Array<Partial<SessionState>>
      activeSessionId?: string
    }

    const sessions =
      parsed.sessions?.length
        ? parsed.sessions.map(item => ({
            ...createDefaultSession(
              defaultProviderId,
              defaultModel,
              item.title?.trim() || 'New Session',
              item.workspaceRoot?.trim() || workspaceRoot,
            ),
            ...item,
          }))
        : [fallbackSession]

    return {
      sessions,
      activeSessionId:
        parsed.activeSessionId && sessions.some(item => item.id === parsed.activeSessionId)
          ? parsed.activeSessionId
          : sessions[0]!.id,
    }
  } catch {
    return {
      sessions: [fallbackSession],
      activeSessionId: fallbackSession.id,
    }
  }
}

function normalizeImportedSessions(
  archiveSessions: Array<Partial<SessionState>>,
  settings: PublicSettings,
): SessionState[] {
  return archiveSessions.map((session, index) => {
    const normalized = normalizeSession(session, settings)

    return {
      ...normalized,
      id: createId(),
      title: session.title?.trim() || `Imported Chat ${index + 1}`,
      messages: normalized.messages.map(message => ({
        id: createId(),
        role: message.role,
        content: message.content,
        attachments: normalizeAttachments(message.attachments),
        pending: false,
        toolEvents: [...(message.toolEvents ?? [])],
      })),
      terminalHistory: normalized.terminalHistory.map(entry => ({
        ...entry,
        id: createId(),
        createdAt: entry.createdAt || new Date().toISOString(),
        status: entry.status === 'error' ? 'error' : 'success',
      })),
    }
  })
}

function reorderWorkspaceSessions(
  sessions: SessionState[],
  workspaceRoot: string,
  groupKey: ReturnType<typeof getSessionGroupKey>,
  sourceId: string,
  targetId: string,
): SessionState[] {
  if (!workspaceRoot || sourceId === targetId) {
    return sessions
  }

  const workspaceIndexes: number[] = []
  const workspaceSessions = sessions.filter((session, index) => {
    const matches =
      session.workspaceRoot === workspaceRoot && getSessionGroupKey(session) === groupKey
    if (matches) {
      workspaceIndexes.push(index)
    }
    return matches
  })

  const sourceIndex = workspaceSessions.findIndex(session => session.id === sourceId)
  const targetIndex = workspaceSessions.findIndex(session => session.id === targetId)

  if (sourceIndex < 0 || targetIndex < 0) {
    return sessions
  }

  const nextWorkspaceSessions = [...workspaceSessions]
  const [movedSession] = nextWorkspaceSessions.splice(sourceIndex, 1)
  if (!movedSession) {
    return sessions
  }
  nextWorkspaceSessions.splice(targetIndex, 0, movedSession)

  const nextSessions = [...sessions]
  workspaceIndexes.forEach((index, workspaceIndex) => {
    nextSessions[index] = nextWorkspaceSessions[workspaceIndex]!
  })
  return nextSessions
}

export default function App() {
  const initialLayout = useMemo(() => restoreLayoutPrefs(), [])
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement | null>(null)
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const workspaceFrameRef = useRef<HTMLDivElement | null>(null)
  const composerDragDepthRef = useRef(0)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [presets, setPresets] = useState<ProviderPreset[]>([])
  const [providerDrafts, setProviderDrafts] = useState<Record<string, ProviderDraft>>({})
  const [workspacePresets, setWorkspacePresets] = useState<WorkspacePreset[]>(() =>
    restoreWorkspacePresets(),
  )
  const [sessions, setSessions] = useState<SessionState[]>([])
  const [activeSessionId, setActiveSessionId] = useState('')
  const [tree, setTree] = useState<FileNode[]>([])
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([])
  const [gitStatus, setGitStatus] = useState<GitStatusPayload | null>(null)
  const [gitSelectedPath, setGitSelectedPath] = useState('')
  const [gitDiff, setGitDiff] = useState<GitDiffPayload | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitCommitMessage, setGitCommitMessage] = useState('')
  const [selectedPendingPath, setSelectedPendingPath] = useState('')
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('files')
  const [sessionFilter, setSessionFilter] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [projectRailView, setProjectRailView] = useState<ProjectRailView>('all')
  const [expandedProjectRoots, setExpandedProjectRoots] = useState<string[]>([])
  const [showArchivedSessions, setShowArchivedSessions] = useState(false)
  const [fileFilter, setFileFilter] = useState('')
  const [changeSourceFilter, setChangeSourceFilter] = useState<'all' | 'agent' | 'manual'>('all')
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([])
  const [draggingSessionId, setDraggingSessionId] = useState('')
  const [dropSessionId, setDropSessionId] = useState('')
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [copiedItemId, setCopiedItemId] = useState('')
  const [theme, setTheme] = useState<ThemeMode>(() => getInitialTheme())
  const [status, setStatus] = useState('Loading workspace...')
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [terminalBusy, setTerminalBusy] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialLayout.sidebarCollapsed)
  const [dockCollapsed, setDockCollapsed] = useState(initialLayout.dockCollapsed)
  const [dockWidth, setDockWidth] = useState(initialLayout.dockWidth)
  const [dockResizing, setDockResizing] = useState(false)
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState('')
  const [accessModeDraft, setAccessModeDraft] = useState<AccessMode>('workspace')
  const [treeRootDraft, setTreeRootDraft] = useState('.')
  const [systemPromptDraft, setSystemPromptDraft] = useState('')
  const [commandTimeoutDraft, setCommandTimeoutDraft] = useState('20000')
  const [maxStepsDraft, setMaxStepsDraft] = useState('8')
  const [safeWriteModeDraft, setSafeWriteModeDraft] = useState(true)
  const [sessionTagDraft, setSessionTagDraft] = useState('')
  const [renamingSessionId, setRenamingSessionId] = useState('')
  const [sessionRenameDraft, setSessionRenameDraft] = useState('')
  const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState('')
  const [composerDragActive, setComposerDragActive] = useState(false)

  const workspaceSessions = useMemo(
    () =>
      settings
        ? sessions.filter(session => session.workspaceRoot === settings.workspaceRoot)
        : sessions,
    [sessions, settings],
  )
  const activeSession =
    workspaceSessions.find(item => item.id === activeSessionId) ??
    workspaceSessions[0] ??
    null
  const activeWorkspaceTabLabel =
    WORKSPACE_TAB_ITEMS.find(tab => tab.id === workspaceTab)?.label ?? 'Workspace'
  const selectedProvider =
    settings?.providers.find(item => item.id === activeSession?.providerId) ??
    settings?.providers[0] ??
    null
  const activePendingChange =
    pendingChanges.find(item => item.path === activeSession?.selectedFile) ?? null
  const activeDraftPatch = activeSession?.draftPatch ?? null
  const selectedGitFile =
    gitStatus?.files.find(file => file.path === gitSelectedPath) ?? gitStatus?.files[0] ?? null

  useEffect(() => {
    if (renamingSessionId && !sessions.some(session => session.id === renamingSessionId)) {
      setRenamingSessionId('')
      setSessionRenameDraft('')
    }
    if (confirmDeleteSessionId && !sessions.some(session => session.id === confirmDeleteSessionId)) {
      setConfirmDeleteSessionId('')
    }
  }, [confirmDeleteSessionId, renamingSessionId, sessions])

  useEffect(() => {
    if (!gitStatus?.files.length) {
      setGitSelectedPath('')
      setGitDiff(null)
      return
    }

    if (!gitStatus.files.some(file => file.path === gitSelectedPath)) {
      setGitSelectedPath(gitStatus.files[0]!.path)
    }
  }, [gitSelectedPath, gitStatus])

  useEffect(() => {
    if (!settings?.workspaceRoot) {
      return
    }

    void loadGitStatus()
  }, [settings?.workspaceRoot])

  useEffect(() => {
    if (!window.roycodeDesktop?.onWorkspaceSelected) {
      return
    }

    return window.roycodeDesktop.onWorkspaceSelected(filePath => {
      if (filePath === DESKTOP_OPEN_GIT_SENTINEL) {
        openWorkspaceTab('git')
        void loadGitStatus(gitSelectedPath)
        return
      }

      void switchWorkspaceRoot(filePath)
    })
  }, [gitSelectedPath, settings?.workspaceRoot])

  useEffect(() => {
    if (workspaceTab !== 'git' || !gitSelectedPath || !gitStatus?.isRepo) {
      return
    }

    void loadGitDiff(gitSelectedPath)
  }, [gitSelectedPath, gitStatus?.isRepo, workspaceTab])

  const visibleFiles = useMemo(() => flattenFiles(tree), [tree])
  const filteredSessions = useMemo(() => {
    const query = sessionFilter.trim().toLowerCase()
    if (!query) {
      return workspaceSessions
    }
    return workspaceSessions.filter(session =>
      [
        session.title,
        session.providerId,
        session.model,
        getSessionPreview(session),
        (session.tags ?? []).join(' '),
      ]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [workspaceSessions, sessionFilter])
  const pinnedSessions = useMemo(
    () => filteredSessions.filter(session => session.pinned && !session.archived),
    [filteredSessions],
  )
  const regularSessions = useMemo(
    () => filteredSessions.filter(session => !session.pinned && !session.archived),
    [filteredSessions],
  )
  const archivedSessions = useMemo(
    () => filteredSessions.filter(session => session.archived),
    [filteredSessions],
  )
  const sidebarProjects = useMemo(() => {
    if (!settings) {
      return []
    }

    const items = new Map<
      string,
      {
        root: string
        name: string
        saved: boolean
        lastUsedAt: string
      }
    >()

    items.set(settings.workspaceRoot, {
      root: settings.workspaceRoot,
      name: getWorkspaceLabel(settings.workspaceRoot),
      saved: workspacePresets.some(preset => preset.root === settings.workspaceRoot),
      lastUsedAt: new Date().toISOString(),
    })

    for (const preset of workspacePresets) {
      if (!items.has(preset.root)) {
        items.set(preset.root, {
          root: preset.root,
          name: preset.name,
          saved: true,
          lastUsedAt: preset.lastUsedAt,
        })
      }
    }

    return [...items.values()]
      .map(project => ({
        ...project,
        chatCount: sessions.filter(
          session => session.workspaceRoot === project.root && !session.archived,
        ).length,
      }))
      .sort((left, right) => {
        const leftActive = left.root === settings.workspaceRoot ? 1 : 0
        const rightActive = right.root === settings.workspaceRoot ? 1 : 0
        if (leftActive !== rightActive) {
          return rightActive - leftActive
        }
        const leftFavorite = workspacePresets.find(
          preset => preset.root === left.root && preset.favorite,
        )
          ? 1
          : 0
        const rightFavorite = workspacePresets.find(
          preset => preset.root === right.root && preset.favorite,
        )
          ? 1
          : 0
        if (leftFavorite !== rightFavorite) {
          return rightFavorite - leftFavorite
        }
        return right.lastUsedAt.localeCompare(left.lastUsedAt)
      })
  }, [settings, workspacePresets, sessions])
  const filteredSidebarProjects = useMemo(() => {
    const query = projectFilter.trim().toLowerCase()
    if (!query) {
      return sidebarProjects
    }

    return sidebarProjects.filter(project =>
      [project.name, project.root]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [sidebarProjects, projectFilter])
  const favoriteSidebarProjects = useMemo(
    () =>
      filteredSidebarProjects.filter(project =>
        workspacePresets.some(
          preset => preset.root === project.root && Boolean(preset.favorite),
        ),
      ),
    [filteredSidebarProjects, workspacePresets],
  )
  const recentSidebarProjects = useMemo(
    () =>
      filteredSidebarProjects.filter(
        project =>
          !workspacePresets.some(
            preset => preset.root === project.root && Boolean(preset.favorite),
          ),
      ),
    [filteredSidebarProjects, workspacePresets],
  )
  const visibleFavoriteSidebarProjects = useMemo(
    () => (projectRailView === 'recent' ? [] : favoriteSidebarProjects),
    [favoriteSidebarProjects, projectRailView],
  )
  const visibleRecentSidebarProjects = useMemo(
    () => (projectRailView === 'favorites' ? [] : recentSidebarProjects),
    [recentSidebarProjects, projectRailView],
  )
  const sidebarProjectSessions = useMemo(() => {
    const entries = new Map<string, SessionState[]>()

    for (const session of sessions) {
      if (session.archived) {
        continue
      }
      const current = entries.get(session.workspaceRoot) ?? []
      current.push(session)
      entries.set(session.workspaceRoot, current)
    }

    for (const item of entries.values()) {
      item.sort((left, right) => {
        const leftPinned = left.pinned ? 1 : 0
        const rightPinned = right.pinned ? 1 : 0
        if (leftPinned !== rightPinned) {
          return rightPinned - leftPinned
        }
        return right.messages.length - left.messages.length
      })
    }

    return entries
  }, [sessions])
  const filteredWorkspacePresets = useMemo(() => {
    const query = projectFilter.trim().toLowerCase()
    if (!query) {
      return workspacePresets
    }

    return workspacePresets.filter(preset =>
      [preset.name, preset.root]
        .join(' ')
        .toLowerCase()
        .includes(query),
    )
  }, [workspacePresets, projectFilter])
  const filteredFiles = useMemo(() => {
    const query = fileFilter.trim().toLowerCase()
    if (!query) {
      return visibleFiles
    }
    return visibleFiles.filter(file => file.path.toLowerCase().includes(query))
  }, [visibleFiles, fileFilter])
  const diffLines = useMemo(
    () =>
      buildLineDiff(
        activeSession?.diskFileContent ?? '',
        activeSession?.fileContent ?? '',
      ),
    [activeSession?.diskFileContent, activeSession?.fileContent],
  )
  const changedLineCount = useMemo(
    () => diffLines.filter(item => item.type !== 'context').length,
    [diffLines],
  )
  const draftPatchDiffLines = useMemo(
    () =>
      activeDraftPatch
        ? buildLineDiff(activeSession?.diskFileContent ?? '', activeDraftPatch.content)
        : [],
    [activeDraftPatch, activeSession?.diskFileContent],
  )
  const draftPatchSummary = useMemo(
    () => summarizeDiffLines(draftPatchDiffLines),
    [draftPatchDiffLines],
  )
  const draftPatchChunks = useMemo(
    () =>
      activeDraftPatch
        ? buildDiffChunks(activeSession?.diskFileContent ?? '', activeDraftPatch.content)
        : [],
    [activeDraftPatch, activeSession?.diskFileContent],
  )
  const [selectedDraftChunkIds, setSelectedDraftChunkIds] = useState<string[]>([])
  const selectedDraftChunks = useMemo(
    () => draftPatchChunks.filter(chunk => selectedDraftChunkIds.includes(chunk.id)),
    [draftPatchChunks, selectedDraftChunkIds],
  )
  const visibleDraftPatchLines = useMemo(
    () => draftPatchDiffLines.slice(0, 120),
    [draftPatchDiffLines],
  )
  const commandPaletteItems = useMemo(() => {
    const query = commandPaletteQuery.trim().toLowerCase()
    const workspaceItems: CommandPaletteItem[] = WORKSPACE_TAB_ITEMS.map(tab => ({
      id: `tab-${tab.id}`,
      section: 'Workspace',
      label: `Open ${tab.label}`,
      hint: tab.label,
      action: 'tab',
      tab: tab.id,
    }))
    const actionItems: CommandPaletteItem[] = [
      {
        id: 'action-new-current',
        section: 'Action',
        label: 'New chat in current project',
        hint: getWorkspaceLabel(settings?.workspaceRoot ?? ''),
        action: 'new-chat-current',
      },
      {
        id: 'action-save-project',
        section: 'Action',
        label: 'Save current project',
        hint: settings?.workspaceRoot ?? '',
        action: 'save-current-project',
      },
      {
        id: 'action-toggle-sidebar',
        section: 'Action',
        label: 'Toggle chat sidebar',
        hint: 'Ctrl+B',
        action: 'toggle-sidebar',
      },
      {
        id: 'action-toggle-dock',
        section: 'Action',
        label: 'Toggle workspace dock',
        hint: 'Ctrl+Shift+D',
        action: 'toggle-dock',
      },
      {
        id: 'action-refresh-git',
        section: 'Action',
        label: 'Refresh git status',
        hint: 'Ctrl+Shift+G',
        action: 'refresh-git',
      },
    ]
    const projectItems: CommandPaletteItem[] = sidebarProjects.flatMap(project => [
      {
        id: `project-open-${project.root}`,
        section: 'Project',
        label: `Open ${project.name}`,
        hint: project.root,
        action: 'project-open',
        root: project.root,
      },
      {
        id: `project-new-${project.root}`,
        section: 'Project',
        label: `New chat in ${project.name}`,
        hint: project.root,
        action: 'project-new-chat',
        root: project.root,
      },
    ])
    const sessionItems: CommandPaletteItem[] = sessions
      .filter(session => !session.archived)
      .map(session => ({
        id: `session-${session.id}`,
        section: 'Chat',
        label: session.title,
        hint: `${getWorkspaceLabel(session.workspaceRoot)} / ${getSessionPreview(session)}`,
        action: 'session-open',
        root: session.workspaceRoot,
        sessionId: session.id,
      }))

    const items = [...actionItems, ...workspaceItems, ...projectItems, ...sessionItems]
    if (!query) {
      return items
    }

    return items.filter(item =>
      [item.label, item.hint, item.section].join(' ').toLowerCase().includes(query),
    )
  }, [
    commandPaletteQuery,
    sessions,
    settings?.workspaceRoot,
    sidebarProjects,
  ])
  const visibleCommandPaletteItems = useMemo(
    () => commandPaletteItems.slice(0, 24),
    [commandPaletteItems],
  )
  const visibleDiffLines = useMemo(() => diffLines.slice(0, 220), [diffLines])
  const pendingChangeCounts = useMemo(
    () => ({
      all: pendingChanges.length,
      agent: pendingChanges.filter(change => change.source === 'agent').length,
      manual: pendingChanges.filter(change => change.source === 'manual').length,
    }),
    [pendingChanges],
  )
  const filteredPendingChanges = useMemo(
    () =>
      changeSourceFilter === 'all'
        ? pendingChanges
        : pendingChanges.filter(change => change.source === changeSourceFilter),
    [pendingChanges, changeSourceFilter],
  )
  const selectedPendingChange =
    filteredPendingChanges.find(item => item.path === selectedPendingPath) ??
    filteredPendingChanges.find(item => item.path === activeSession?.selectedFile) ??
    filteredPendingChanges[0] ??
    null
  const pendingDiffLines = useMemo(
    () =>
      selectedPendingChange
        ? buildLineDiff(
            selectedPendingChange.originalContent,
            selectedPendingChange.content,
          )
        : [],
    [selectedPendingChange],
  )
  const pendingDiffSummary = useMemo(
    () => summarizeDiffLines(pendingDiffLines),
    [pendingDiffLines],
  )
  const pendingDiffChunks = useMemo(
    () =>
      selectedPendingChange
        ? buildDiffChunks(
            selectedPendingChange.originalContent,
            selectedPendingChange.content,
          )
        : [],
    [selectedPendingChange],
  )
  const selectedPendingChunks = useMemo(
    () => pendingDiffChunks.filter(chunk => selectedChunkIds.includes(chunk.id)),
    [pendingDiffChunks, selectedChunkIds],
  )
  const visiblePendingDiffLines = useMemo(
    () => pendingDiffLines.slice(0, 140),
    [pendingDiffLines],
  )
  const isDesktopShell =
    typeof window !== 'undefined' && Boolean(window.roycodeDesktop?.isDesktop)
  const visibleSlashCommands = useMemo(() => {
    const rawPrompt = activeSession?.prompt ?? ''
    const trimmed = rawPrompt.trimStart()
    if (!trimmed.startsWith('/')) {
      return []
    }

    const query = trimmed.slice(1).toLowerCase()
    return SLASH_COMMANDS.filter(command =>
      [command.id, command.label, command.description].join(' ').toLowerCase().includes(query),
    ).slice(0, 6)
  }, [activeSession?.prompt])
  const showPromptLanding =
    activeSession?.messages.length === 1 &&
    !activeSession.messages.some(message => message.role === 'user')
  const currentProviderName = selectedProvider?.name ?? 'No provider'
  const editorDirty =
    (activeSession?.fileContent ?? '') !== (activeSession?.loadedFileContent ?? '') ||
    Boolean(activePendingChange)
  const latestMessage = activeSession?.messages[activeSession.messages.length - 1]
  const latestMessageKey = [
    activeSession?.id ?? '',
    activeSession?.messages.length ?? 0,
    latestMessage?.id ?? '',
    latestMessage?.content.length ?? 0,
    latestMessage?.toolEvents?.length ?? 0,
  ].join(':')
  const shellClassName = `shell shell-modern ${
    sidebarCollapsed ? 'shell-sidebar-collapsed' : ''
  }`
  const workspaceFrameClassName = `workspace-frame ${
    dockCollapsed ? 'workspace-frame-dock-collapsed' : ''
  } ${dockResizing ? 'workspace-frame-resizing' : ''}`
  const shellStyle = {
    '--sidebar-width': sidebarCollapsed ? '0px' : '290px',
    '--dock-width': dockCollapsed ? '0px' : `${dockWidth}px`,
  } as CSSProperties

  function applySettingsFromResponse(
    nextSettings: PublicSettings,
    sourceSessions = sessions,
  ) {
    const defaultProviderId =
      nextSettings.selectedProviderId ?? nextSettings.providers[0]?.id ?? ''
    const defaultModel =
      nextSettings.selectedModel ??
      nextSettings.providers[0]?.defaultModel ??
      nextSettings.providers[0]?.models[0] ??
      ''
    const normalizedSessions = ensureWorkspaceSessions(
      sourceSessions.map(session => normalizeSession(session, nextSettings)),
      nextSettings,
      defaultProviderId,
      defaultModel,
    )
    const nextWorkspaceSessions = normalizedSessions.filter(
      session => session.workspaceRoot === nextSettings.workspaceRoot,
    )

    setSettings(nextSettings)
    setProviderDrafts(mapProviders(nextSettings.providers))
    setWorkspaceRootDraft(nextSettings.workspaceRoot)
    setAccessModeDraft(nextSettings.accessMode)
    setTreeRootDraft(current =>
      nextSettings.accessMode === 'unrestricted'
        ? current.trim() || nextSettings.workspaceRoot
        : '.',
    )
    setSystemPromptDraft(nextSettings.systemPrompt)
    setCommandTimeoutDraft(String(nextSettings.commandTimeoutMs))
    setMaxStepsDraft(String(nextSettings.maxAgentSteps))
    setSafeWriteModeDraft(nextSettings.safeWriteMode)
    setWorkspacePresets(previous =>
      upsertWorkspacePreset(previous, nextSettings.workspaceRoot),
    )
    setSessions(normalizedSessions)
    setActiveSessionId(current =>
      nextWorkspaceSessions.some(session => session.id === current)
        ? current
        : nextWorkspaceSessions[0]?.id ?? normalizedSessions[0]?.id ?? '',
    )
  }

  function updateSession(
    sessionId: string,
    updater: (session: SessionState) => SessionState,
  ) {
    setSessions(previous =>
      previous.map(session => (session.id === sessionId ? updater(session) : session)),
    )
  }

  function updateActiveSession(updater: (session: SessionState) => SessionState) {
    if (!activeSession) {
      return
    }
    updateSession(activeSession.id, updater)
  }

  function buildSessionForWorkspaceRoot(
    workspaceRoot: string,
    title = `Session ${sessions.filter(session => session.workspaceRoot === workspaceRoot && !session.archived).length + 1}`,
  ): SessionState {
    const providerId = selectedProvider?.id ?? settings?.selectedProviderId ?? ''
    const model =
      selectedProvider?.defaultModel ??
      selectedProvider?.models[0] ??
      settings?.selectedModel ??
      ''

    return createDefaultSession(providerId, model, title, workspaceRoot)
  }

  function buildWorkspaceSession(title = `Session ${workspaceSessions.length + 1}`): SessionState {
    return buildSessionForWorkspaceRoot(settings?.workspaceRoot ?? '', title)
  }

  function getTreeRequestPath(
    mode: AccessMode = settings?.accessMode ?? accessModeDraft,
    workspaceRoot: string = settings?.workspaceRoot ?? workspaceRootDraft,
    requestedPath = treeRootDraft,
  ): string {
    if (mode === 'unrestricted') {
      return requestedPath.trim() || workspaceRoot.trim() || '.'
    }

    return '.'
  }

  async function loadTree(options: {
    path?: string
    accessMode?: AccessMode
    workspaceRoot?: string
  } = {}) {
    const nextAccessMode = options.accessMode ?? settings?.accessMode ?? accessModeDraft
    const nextWorkspaceRoot = options.workspaceRoot ?? settings?.workspaceRoot ?? workspaceRootDraft
    const nextPath = getTreeRequestPath(
      nextAccessMode,
      nextWorkspaceRoot,
      options.path ?? treeRootDraft,
    )
    const payload = await apiFetch<{ tree: FileNode[] }>(
      `/api/workspace/tree?path=${encodeURIComponent(nextPath)}&depth=4`,
    )
    setTree(payload.tree)
    setTreeRootDraft(nextAccessMode === 'unrestricted' ? nextPath : '.')
  }

  async function loadPendingChanges() {
    const payload = await apiFetch<{ changes: PendingChange[] }>('/api/pending-changes')
    setPendingChanges(payload.changes)
  }

  async function loadGitStatus(preferredPath?: string) {
    try {
      const payload = await apiFetch<GitStatusPayload>('/api/git/status')
      setGitStatus(payload)
      const nextPath =
        (preferredPath && payload.files.some(file => file.path === preferredPath) && preferredPath) ||
        payload.files[0]?.path ||
        ''
      setGitSelectedPath(nextPath)
      if (!payload.isRepo || !nextPath) {
        setGitDiff(null)
      }
    } catch (error) {
      setGitStatus(null)
      setGitDiff(null)
      setStatus(error instanceof Error ? error.message : 'Failed to load git status')
    }
  }

  async function loadGitDiff(path: string) {
    if (!path) {
      setGitDiff(null)
      return
    }

    setGitBusy(true)
    setGitSelectedPath(path)
    try {
      const payload = await apiFetch<GitDiffPayload>(`/api/git/diff?path=${encodeURIComponent(path)}`)
      setGitDiff(payload)
    } catch (error) {
      setGitDiff(null)
      setStatus(error instanceof Error ? error.message : 'Failed to load git diff')
    } finally {
      setGitBusy(false)
    }
  }

  async function switchWorkspaceRoot(nextRoot: string) {
    const root = nextRoot.trim()
    if (!root || !settings) {
      return
    }

    setWorkspaceRootDraft(root)
    setStatus(`Switching to ${getWorkspaceLabel(root)}...`)
    try {
      const nextSettings = await persistSettings({ workspaceRoot: root })
      applySettingsFromResponse(nextSettings)
      const nextTreePath = nextSettings.accessMode === 'unrestricted' ? root : '.'
      setTreeRootDraft(nextTreePath)
      await Promise.all([
        loadTree({
          path: nextTreePath,
          accessMode: nextSettings.accessMode,
          workspaceRoot: nextSettings.workspaceRoot,
        }),
        loadPendingChanges(),
        loadGitStatus(),
      ])
      setStatus(`Switched to ${getWorkspaceLabel(root)}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to switch workspace')
    }
  }

  async function pickDesktopWorkspaceFolder() {
    const nextRoot = await window.roycodeDesktop?.pickWorkspaceFolder?.()
    if (!nextRoot) {
      return
    }

    await switchWorkspaceRoot(nextRoot)
  }

  async function revealSelectedFileInDesktop() {
    if (!isDesktopShell || !settings?.workspaceRoot || !activeSession?.selectedFile) {
      return
    }

    const targetPath = pathJoinForDesktop(settings.workspaceRoot, activeSession.selectedFile)
    await window.roycodeDesktop?.revealPath(targetPath)
  }

  async function browseTreeRoot(usePicker = false) {
    if (!settings) {
      return
    }

    let nextPath = treeRootDraft.trim()
    if (usePicker && isDesktopShell) {
      nextPath = (await window.roycodeDesktop?.pickWorkspaceFolder?.()) ?? nextPath
    }

    if (!nextPath) {
      return
    }

    setStatus(`Loading ${nextPath}...`)
    try {
      await loadTree({
        path: nextPath,
        accessMode: settings.accessMode,
        workspaceRoot: settings.workspaceRoot,
      })
      setStatus(`Loaded ${nextPath}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to browse path')
    }
  }

  async function writeWorkspaceFile(path: string, content: string) {
    return apiFetch<{ ok: boolean; mode: 'staged' | 'written' }>('/api/workspace/file', {
      method: 'PUT',
      body: JSON.stringify({
        path,
        content,
      }),
    })
  }

  async function openFile(filePath: string, sessionId = activeSession?.id) {
    if (!sessionId || !filePath) {
      return
    }

    openWorkspaceTab('editor')
    setFileBusy(true)
    try {
      const payload = await apiFetch<WorkspaceFilePayload>(
        `/api/workspace/file?path=${encodeURIComponent(filePath)}`,
      )
      updateSession(sessionId, session => ({
        ...session,
        selectedFile: payload.path,
        fileContent: payload.content,
        loadedFileContent: payload.content,
        diskFileContent: payload.diskContent,
      }))
      if (payload.pendingChange) {
        setSelectedPendingPath(payload.path)
      }
      setStatus(`Opened ${payload.path}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to open file')
    } finally {
      setFileBusy(false)
    }
  }

  async function loadWorkspace() {
    setStatus('Loading settings...')
    try {
      const payload = await apiFetch<{
        settings: PublicSettings
        presets: ProviderPreset[]
      }>('/api/settings')

      const defaultProviderId =
        payload.settings.selectedProviderId ?? payload.settings.providers[0]?.id ?? ''
      const defaultModel =
        payload.settings.selectedModel ??
        payload.settings.providers[0]?.defaultModel ??
        payload.settings.providers[0]?.models[0] ??
        ''

      const restored = restoreSessions(
        defaultProviderId,
        defaultModel,
        payload.settings.workspaceRoot,
      )
      const normalized = ensureWorkspaceSessions(
        restored.sessions.map(session => normalizeSession(session, payload.settings)),
        payload.settings,
        defaultProviderId,
        defaultModel,
      )
      const nextWorkspaceSessions = normalized.filter(
        session => session.workspaceRoot === payload.settings.workspaceRoot,
      )

      setSettings(payload.settings)
      setPresets(payload.presets)
      setProviderDrafts(mapProviders(payload.settings.providers))
      setWorkspacePresets(previous =>
        upsertWorkspacePreset(previous, payload.settings.workspaceRoot),
      )
      setWorkspaceRootDraft(payload.settings.workspaceRoot)
      setAccessModeDraft(payload.settings.accessMode)
      setTreeRootDraft(
        payload.settings.accessMode === 'unrestricted'
          ? payload.settings.workspaceRoot
          : '.',
      )
      setSystemPromptDraft(payload.settings.systemPrompt)
      setCommandTimeoutDraft(String(payload.settings.commandTimeoutMs))
      setMaxStepsDraft(String(payload.settings.maxAgentSteps))
      setSafeWriteModeDraft(payload.settings.safeWriteMode)
      setSessions(normalized)
      setActiveSessionId(
        nextWorkspaceSessions.some(item => item.id === restored.activeSessionId)
          ? restored.activeSessionId
          : nextWorkspaceSessions[0]?.id ?? normalized[0]?.id ?? '',
      )

      await Promise.all([
        loadTree({
          path:
            payload.settings.accessMode === 'unrestricted'
              ? payload.settings.workspaceRoot
              : '.',
          accessMode: payload.settings.accessMode,
          workspaceRoot: payload.settings.workspaceRoot,
        }),
        loadPendingChanges(),
      ])
      setStatus('Workspace ready')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Initialization failed')
    }
  }

  function createSessionTab() {
    const nextSession = buildWorkspaceSession()
    setSessions(previous => [...previous, nextSession])
    setActiveSessionId(nextSession.id)
    setSessionFilter('')
    setStatus('Created a new session')
  }

  async function createSessionForProject(root: string) {
    const nextSession = buildSessionForWorkspaceRoot(root)
    const nextSessions = [...sessions, nextSession]

    setSessions(nextSessions)
    setSessionFilter('')
    setProjectFilter('')

    if (root === settings?.workspaceRoot) {
      setActiveSessionId(nextSession.id)
      setStatus(`Created a new chat in ${getWorkspaceLabel(root)}`)
      return
    }

    try {
      const nextSettings = await persistSettings({ workspaceRoot: root })
      applySettingsFromResponse(nextSettings, nextSessions)
      await Promise.all([loadTree(), loadPendingChanges()])
      setActiveSessionId(nextSession.id)
      setStatus(`Switched to ${getWorkspaceLabel(root)} / created chat`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create chat in project')
    }
  }

  function startSessionRename(sessionId: string) {
    const target = sessions.find(session => session.id === sessionId)
    if (!target) {
      return
    }

    setRenamingSessionId(sessionId)
    setSessionRenameDraft(target.title)
    setConfirmDeleteSessionId(current => (current === sessionId ? '' : current))
    setStatus('Rename the chat and press Enter to save')
  }

  function commitSessionRename(sessionId: string) {
    const target = sessions.find(session => session.id === sessionId)
    if (!target) {
      setRenamingSessionId('')
      setSessionRenameDraft('')
      return
    }

    const nextTitle = sessionRenameDraft.trim()
    updateSession(sessionId, session => ({
      ...session,
      title: nextTitle || session.title,
    }))
    setRenamingSessionId('')
    setSessionRenameDraft('')
    setStatus(nextTitle && nextTitle !== target.title ? 'Chat renamed' : 'Rename unchanged')
  }

  function cancelSessionRename() {
    setRenamingSessionId('')
    setSessionRenameDraft('')
  }

  function requestDeleteSession(sessionId: string) {
    if (confirmDeleteSessionId === sessionId) {
      setConfirmDeleteSessionId('')
      closeSessionTab(sessionId)
      return
    }

    setConfirmDeleteSessionId(sessionId)
    setRenamingSessionId(current => (current === sessionId ? '' : current))
    setStatus('Click delete again to confirm')
  }

  function closeSessionTab(sessionId: string) {
    const currentWorkspaceRoot = settings?.workspaceRoot ?? ''
    const targetSession = sessions.find(session => session.id === sessionId)
    if (!targetSession) {
      return
    }

    const targetWorkspaceSessions = sessions.filter(
      session => session.workspaceRoot === targetSession.workspaceRoot,
    )

    if (
      targetSession.workspaceRoot === currentWorkspaceRoot &&
      targetWorkspaceSessions.length <= 1
    ) {
      setStatus('Keep at least one chat open in the current project')
      return
    }

    let remaining = sessions.filter(item => item.id !== sessionId)

    if (targetSession.workspaceRoot === currentWorkspaceRoot) {
      const remainingVisible = remaining.filter(
        item => item.workspaceRoot === targetSession.workspaceRoot && !item.archived,
      )

      if (!remainingVisible.length) {
        const fallbackSession = buildSessionForWorkspaceRoot(
          targetSession.workspaceRoot,
          'New Session',
        )
        remaining = [...remaining, fallbackSession]
      }
    }

    setSessions(remaining)
    if (activeSessionId === sessionId) {
      const nextWorkspaceSession = remaining.find(
        item => item.workspaceRoot === currentWorkspaceRoot && !item.archived,
      )
      setActiveSessionId(nextWorkspaceSession?.id ?? remaining[0]!.id)
    }
    setConfirmDeleteSessionId('')
    if (renamingSessionId === sessionId) {
      setRenamingSessionId('')
      setSessionRenameDraft('')
    }
    setStatus('Chat deleted')
  }

  function toggleSessionPinned(sessionId: string) {
    setSessions(previous =>
      previous.map(session =>
        session.id === sessionId
          ? {
              ...session,
              pinned: !session.pinned,
              archived: false,
            }
          : session,
      ),
    )
    const target = sessions.find(session => session.id === sessionId)
    if (target) {
      setStatus(target.pinned ? 'Chat unpinned' : 'Chat pinned')
    }
  }

  function toggleSessionArchived(sessionId: string) {
    const currentWorkspaceRoot = settings?.workspaceRoot ?? ''
    const targetSession = sessions.find(session => session.id === sessionId)
    if (!targetSession) {
      return
    }

    const targetWorkspaceRoot = targetSession.workspaceRoot
    const willArchive = targetSession ? !targetSession.archived : false
    let nextActiveId = activeSessionId
    let nextStatus = 'Chat updated'

    setSessions(previous => {
      const target = previous.find(session => session.id === sessionId)
      if (!target) {
        return previous
      }

      nextStatus = willArchive ? 'Chat archived' : 'Chat restored'

      let nextSessions = previous.map(session =>
        session.id === sessionId
          ? {
              ...session,
              archived: willArchive,
              pinned: willArchive ? false : session.pinned,
            }
          : session,
      )

      if (willArchive) {
        if (targetWorkspaceRoot === currentWorkspaceRoot) {
          const remainingVisible = nextSessions.filter(
            session => session.workspaceRoot === targetWorkspaceRoot && !session.archived,
          )

          if (!remainingVisible.length) {
            const fallbackSession = buildSessionForWorkspaceRoot(
              targetWorkspaceRoot,
              'New Session',
            )
            nextSessions = [...nextSessions, fallbackSession]
            nextActiveId = fallbackSession.id
          } else if (activeSessionId === sessionId) {
            nextActiveId = remainingVisible[0]!.id
          }
        }
      } else if (targetWorkspaceRoot === currentWorkspaceRoot) {
        nextActiveId = sessionId
      }

      return nextSessions
    })

    if (nextActiveId !== activeSessionId) {
      setActiveSessionId(nextActiveId)
    }
    if (willArchive && targetWorkspaceRoot === currentWorkspaceRoot) {
      setShowArchivedSessions(true)
    }
    if (willArchive && confirmDeleteSessionId === sessionId) {
      setConfirmDeleteSessionId('')
    }
    setStatus(nextStatus)
  }

  function commitActiveSessionTags(value = sessionTagDraft) {
    const normalizedTags = normalizeSessionTags(value)
    setSessionTagDraft(normalizedTags.join(', '))
    updateActiveSession(session => ({
      ...session,
      tags: normalizedTags,
    }))
  }

  function moveWorkspaceSession(sourceId: string, targetId: string) {
    if (!settings?.workspaceRoot || sourceId === targetId) {
      return
    }

    const sourceSession = sessions.find(session => session.id === sourceId)
    const targetSession = sessions.find(session => session.id === targetId)

    if (!sourceSession || !targetSession) {
      return
    }

    if (
      sourceSession.workspaceRoot !== settings.workspaceRoot ||
      targetSession.workspaceRoot !== settings.workspaceRoot ||
      getSessionGroupKey(sourceSession) !== getSessionGroupKey(targetSession)
    ) {
      return
    }

    setSessions(previous =>
      reorderWorkspaceSessions(
        previous,
        settings.workspaceRoot,
        getSessionGroupKey(sourceSession),
        sourceId,
        targetId,
      ),
    )
    setStatus(`Reordered "${sourceSession.title}"`)
  }

  async function persistSettings(
    overrides: Partial<Pick<
      PublicSettings,
      | 'appName'
      | 'workspaceRoot'
      | 'accessMode'
      | 'selectedProviderId'
      | 'selectedModel'
      | 'systemPrompt'
      | 'commandTimeoutMs'
      | 'maxAgentSteps'
      | 'safeWriteMode'
    >> = {},
  ): Promise<PublicSettings> {
    if (!settings) {
      throw new Error('Settings are not loaded yet')
    }

    const nextWorkspaceRoot = overrides.workspaceRoot ?? workspaceRootDraft.trim() ?? ''
    const nextSystemPrompt = overrides.systemPrompt ?? systemPromptDraft.trim() ?? ''
    const nextCommandTimeoutDraftValue = Number(commandTimeoutDraft)
    const nextMaxStepsDraftValue = Number(maxStepsDraft)
    const nextCommandTimeout =
      overrides.commandTimeoutMs ??
      (Number.isFinite(nextCommandTimeoutDraftValue) && nextCommandTimeoutDraftValue > 0
        ? nextCommandTimeoutDraftValue
        : settings.commandTimeoutMs)
    const nextMaxSteps =
      overrides.maxAgentSteps ??
      (Number.isFinite(nextMaxStepsDraftValue) && nextMaxStepsDraftValue > 0
        ? nextMaxStepsDraftValue
        : settings.maxAgentSteps)

    const payload = await apiFetch<{ settings: PublicSettings }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        appName: overrides.appName ?? settings.appName,
        workspaceRoot: nextWorkspaceRoot || settings.workspaceRoot,
        accessMode: overrides.accessMode ?? accessModeDraft,
        selectedProviderId: overrides.selectedProviderId ?? activeSession?.providerId,
        selectedModel: overrides.selectedModel ?? activeSession?.model,
        systemPrompt: nextSystemPrompt || settings.systemPrompt,
        commandTimeoutMs: nextCommandTimeout,
        maxAgentSteps: nextMaxSteps,
        safeWriteMode: overrides.safeWriteMode ?? safeWriteModeDraft,
      }),
    })

    return payload.settings
  }

  async function saveCurrentFile() {
    if (!activeSession?.selectedFile) {
      setStatus('Select a file first')
      return
    }

    setFileBusy(true)
    try {
      const payload = await writeWorkspaceFile(activeSession.selectedFile, activeSession.fileContent)

      await Promise.all([loadTree(), loadPendingChanges()])
      await openFile(activeSession.selectedFile, activeSession.id)
      setStatus(
        payload.mode === 'staged'
          ? `Staged ${activeSession.selectedFile} for approval`
          : `Saved ${activeSession.selectedFile}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save file')
    } finally {
      setFileBusy(false)
    }
  }

  async function saveGlobalSettings() {
    if (!settings) {
      return
    }

    setStatus('Saving settings...')
    try {
      const nextSettings = await persistSettings()
      applySettingsFromResponse(nextSettings)
      const nextTreePath =
        nextSettings.accessMode === 'unrestricted'
          ? settings.accessMode !== nextSettings.accessMode ||
            settings.workspaceRoot !== nextSettings.workspaceRoot
            ? nextSettings.workspaceRoot
            : treeRootDraft.trim() || nextSettings.workspaceRoot
          : '.'
      setTreeRootDraft(nextTreePath)
      await Promise.all([
        loadTree({
          path: nextTreePath,
          accessMode: nextSettings.accessMode,
          workspaceRoot: nextSettings.workspaceRoot,
        }),
        loadPendingChanges(),
      ])
      setStatus('Settings saved')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save settings')
    }
  }

  function updateProviderDraft(
    providerId: string,
    updater: (draft: ProviderDraft) => ProviderDraft,
  ) {
    setProviderDrafts(previous => {
      const current = previous[providerId]
      if (!current) {
        return previous
      }
      return {
        ...previous,
        [providerId]: updater(current),
      }
    })
  }

  async function addPreset(presetId: ProviderPreset['id']) {
    setStatus(`Adding ${presetId} provider...`)
    try {
      const payload = await apiFetch<{ settings: PublicSettings }>('/api/providers', {
        method: 'POST',
        body: JSON.stringify({ preset: presetId }),
      })
      applySettingsFromResponse(payload.settings)
      setStatus(`Added ${presetId} provider`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to add provider')
    }
  }

  async function saveProvider(providerId: string) {
    const draft = providerDrafts[providerId]
    if (!draft) {
      return
    }

    const models = parseModelsText(draft.modelsText)
    setStatus(`Saving ${draft.name}...`)
    try {
      const payload = await apiFetch<{ settings: PublicSettings }>(
        `/api/providers/${encodeURIComponent(providerId)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            name: draft.name,
            preset: draft.preset,
            baseUrl: draft.baseUrl,
            apiKey: draft.apiKeyInput,
            models,
            defaultModel:
              models.includes(draft.defaultModel ?? '') ? draft.defaultModel : models[0],
            enabled: draft.enabled,
            notes: draft.notes,
          }),
        },
      )
      applySettingsFromResponse(payload.settings)
      setStatus(`${draft.name} saved`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to save provider')
    }
  }

  async function refreshProviderModels(providerId: string) {
    const draft = providerDrafts[providerId]
    setStatus(`Refreshing models for ${draft?.name ?? providerId}...`)
    try {
      const payload = await apiFetch<{ settings: PublicSettings }>(
        `/api/providers/${encodeURIComponent(providerId)}/refresh-models`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      applySettingsFromResponse(payload.settings)
      setStatus('Model list refreshed')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to refresh models')
    }
  }

  async function removeProvider(providerId: string) {
    setStatus('Removing provider...')
    try {
      const payload = await apiFetch<{ settings: PublicSettings }>(
        `/api/providers/${encodeURIComponent(providerId)}`,
        { method: 'DELETE' },
      )
      applySettingsFromResponse(payload.settings)
      setStatus('Provider removed')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to remove provider')
    }
  }

  function updateCurrentAssistantMessage(
    sessionId: string,
    messageId: string,
    updater: (message: ChatMessage) => ChatMessage,
  ) {
    updateSession(sessionId, session => ({
      ...session,
      messages: session.messages.map(message =>
        message.id === messageId ? updater(message) : message,
      ),
    }))
  }

  async function applySlashCommand(commandId: string, trailingText = ''): Promise<boolean> {
    const command = SLASH_COMMANDS.find(item => item.id === commandId)
    if (!command || !activeSession) {
      return false
    }

    if ('action' in command && command.action === 'open-git') {
      openWorkspaceTab('git')
      await loadGitStatus(gitSelectedPath)
      setStatus('Opened Git workspace')
      return true
    }

    if ('action' in command && command.action === 'refresh-git') {
      openWorkspaceTab('git')
      await loadGitStatus(gitSelectedPath)
      setStatus('Git status refreshed')
      return true
    }

    const promptTemplate = 'prompt' in command ? command.prompt : ''
    const nextPrompt = [promptTemplate, trailingText.trim()].filter(Boolean).join('\n\n')
    updateActiveSession(session => ({
      ...session,
      prompt: nextPrompt,
    }))
    setStatus(`${command.label} template inserted`)
    return true
  }

  async function sendPrompt() {
    if (!settings || !activeSession || busy) {
      return
    }

    const providerId = activeSession.providerId || settings.selectedProviderId || ''
    const provider =
      settings.providers.find(item => item.id === providerId) ?? settings.providers[0]
    const model =
      activeSession.model ||
      provider?.defaultModel ||
      provider?.models[0] ||
      settings.selectedModel ||
      ''
    let prompt = activeSession.prompt.trim()
    const promptAttachments = [...(activeSession.promptAttachments ?? [])]

    if (!provider || !model) {
      setStatus('Configure a provider and model first')
      return
    }
    if (!prompt && !promptAttachments.length) {
      setStatus('Enter a prompt or attach a file/image first')
      return
    }

    const slashMatch = prompt.match(/^\/([a-z-]+)\b(.*)$/i)
    if (slashMatch) {
      const [, commandId, trailingText] = slashMatch
      const command = SLASH_COMMANDS.find(item => item.id === commandId.toLowerCase())
      if (command && 'action' in command) {
        await applySlashCommand(command.id, trailingText)
        return
      }
      if (command && 'prompt' in command) {
        prompt = [command.prompt, trailingText.trim()].filter(Boolean).join('\n\n')
      }
    }

    const sessionId = activeSession.id
    const selectedFile = activeSession.selectedFile
    const userMessage = createMessage('user', prompt, promptAttachments)
    const assistantMessage = createMessage('assistant', '', [], true)
    const title =
      activeSession.title.startsWith('Session ')
        ? (prompt || promptAttachments[0]?.name || activeSession.title).slice(0, 24)
        : activeSession.title
    const requestMessages = [
      ...activeSession.messages.map(message => ({
        role: message.role,
        content: buildMessageContentForRequest(message),
      })),
      {
        role: 'user' as const,
        content: buildMessageContentForRequest({
          content: prompt,
          attachments: promptAttachments,
        }),
      },
    ]

    setBusy(true)
    updateSession(sessionId, session => ({
      ...session,
      title,
      providerId: provider.id,
      model,
      prompt: '',
      promptAttachments: [],
      messages: [...session.messages, userMessage, assistantMessage],
    }))
    setStatus(`Requesting ${provider.name} / ${model}...`)

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          providerId: provider.id,
          model,
          cwd: activeSession.terminalCwd || '.',
          messages: requestMessages,
        }),
      })

      await readNdjsonStream(response, event => {
        switch (event.type) {
          case 'status':
            setStatus(event.message)
            break
          case 'text-delta':
            updateCurrentAssistantMessage(sessionId, assistantMessage.id, message => ({
              ...message,
              content: message.content + event.delta,
            }))
            break
          case 'tool-start':
            updateCurrentAssistantMessage(sessionId, assistantMessage.id, message =>
              appendToolEvent(message, {
                name: event.name,
                input: event.input,
                output: TOOL_PENDING_OUTPUT,
              }),
            )
            break
          case 'tool-result':
            updateCurrentAssistantMessage(sessionId, assistantMessage.id, message =>
              resolveToolResult(message, {
                name: event.name,
                output: event.output,
              }),
            )
            break
          case 'final':
            updateCurrentAssistantMessage(sessionId, assistantMessage.id, message => ({
              ...message,
              content: event.answer,
              pending: false,
              toolEvents: event.toolEvents,
            }))
            setStatus(`Response finished with ${event.model}`)
            break
          case 'error':
            updateCurrentAssistantMessage(sessionId, assistantMessage.id, message => ({
              ...message,
              content: message.content || `Request failed: ${event.error}`,
              pending: false,
            }))
            setStatus(event.error)
            break
        }
      })

      await Promise.all([loadTree(), loadPendingChanges()])
      if (selectedFile) {
        await openFile(selectedFile, sessionId)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message'
      updateCurrentAssistantMessage(sessionId, assistantMessage.id, current => ({
        ...current,
        content: current.content || `Request failed: ${message}`,
        pending: false,
      }))
      setStatus(message)
    } finally {
      setBusy(false)
    }
  }

  async function runTerminalCommand(commandOverride?: string) {
    if (!activeSession || terminalBusy) {
      return
    }

    openWorkspaceTab('terminal')
    const command = (commandOverride ?? activeSession.terminalCommand).trim()
    if (!command) {
      setStatus('Enter a command first')
      return
    }

    setTerminalBusy(true)
    setStatus(`Running command: ${command}`)
    try {
      const payload = await apiFetch<{
        ok: boolean
        command: string
        cwd: string
        output: string
      }>('/api/workspace/command', {
        method: 'POST',
        body: JSON.stringify({
          command,
          cwd: activeSession.terminalCwd || '.',
          timeoutMs: settings?.commandTimeoutMs,
        }),
      })

      const entry: TerminalEntry = {
        id: createId(),
        command: payload.command,
        cwd: payload.cwd,
        output: payload.output,
        createdAt: new Date().toISOString(),
        status: 'success',
      }

      updateActiveSession(session => ({
        ...session,
        terminalCommand: '',
        terminalHistory: [entry, ...session.terminalHistory],
      }))
      setStatus('Command completed')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Command failed'
      const entry: TerminalEntry = {
        id: createId(),
        command,
        cwd: activeSession.terminalCwd || '.',
        output: message,
        createdAt: new Date().toISOString(),
        status: 'error',
      }
      updateActiveSession(session => ({
        ...session,
        terminalHistory: [entry, ...session.terminalHistory],
      }))
      setStatus(message)
    } finally {
      setTerminalBusy(false)
      void loadGitStatus(gitSelectedPath)
    }
  }

  async function stageGitFile(path?: string) {
    setGitBusy(true)
    try {
      const payload = await apiFetch<{ ok: boolean; status: GitStatusPayload }>('/api/git/stage', {
        method: 'POST',
        body: JSON.stringify(path ? { path } : {}),
      })
      setGitStatus(payload.status)
      if (path) {
        await loadGitDiff(path)
      } else {
        setGitDiff(null)
      }
      setStatus(path ? `Staged ${path}` : 'Staged all changes')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to stage git changes')
    } finally {
      setGitBusy(false)
    }
  }

  async function unstageGitFile(path: string) {
    setGitBusy(true)
    try {
      const payload = await apiFetch<{ ok: boolean; status: GitStatusPayload }>('/api/git/unstage', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setGitStatus(payload.status)
      await loadGitDiff(path)
      setStatus(`Unstaged ${path}`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to unstage git changes')
    } finally {
      setGitBusy(false)
    }
  }

  async function commitGitChanges() {
    if (!gitCommitMessage.trim()) {
      setStatus('Enter a commit message first')
      return
    }

    setGitBusy(true)
    try {
      const payload = await apiFetch<{
        ok: boolean
        summary: string
        status: GitStatusPayload
      }>('/api/git/commit', {
        method: 'POST',
        body: JSON.stringify({ message: gitCommitMessage.trim() }),
      })
      setGitStatus(payload.status)
      setGitDiff(null)
      setGitCommitMessage('')
      setStatus(payload.summary.trim() || 'Commit created')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to create commit')
    } finally {
      setGitBusy(false)
    }
  }

  async function applyPending(path: string) {
    openWorkspaceTab('changes')
    setStatus(`Applying ${path}...`)
    try {
      await apiFetch<{ ok: boolean; applied: PendingChange }>('/api/pending-changes/apply', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession?.selectedFile === path) {
        await openFile(path, activeSession.id)
      }
      setStatus(`${path} applied to disk`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Apply failed')
    }
  }

  async function rejectPending(path: string) {
    openWorkspaceTab('changes')
    setStatus(`Discarding ${path}...`)
    try {
      await apiFetch<{ ok: boolean }>('/api/pending-changes/reject', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession?.selectedFile === path) {
        await openFile(path, activeSession.id)
      }
      setStatus(`${path} discarded`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Discard failed')
    }
  }

  async function applyAllPending() {
    if (!pendingChanges.length) {
      setStatus('No pending changes')
      return
    }

    openWorkspaceTab('changes')
    setStatus('Applying all pending changes...')
    try {
      await apiFetch<{ ok: boolean; applied: PendingChange[] }>(
        '/api/pending-changes/apply-all',
        {
          method: 'POST',
          body: JSON.stringify({}),
        },
      )
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession?.selectedFile) {
        await openFile(activeSession.selectedFile, activeSession.id)
      }
      setStatus('All pending changes were written to disk')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Apply all failed')
    }
  }

  async function applyFilteredPending() {
    if (!filteredPendingChanges.length) {
      setStatus('No matching pending changes')
      return
    }

    openWorkspaceTab('changes')
    setStatus(`Applying ${filteredPendingChanges.length} filtered changes...`)

    try {
      await Promise.all(
        filteredPendingChanges.map(change =>
          apiFetch<{ ok: boolean; applied: PendingChange }>('/api/pending-changes/apply', {
            method: 'POST',
            body: JSON.stringify({ path: change.path }),
          }),
        ),
      )
      await Promise.all([loadTree(), loadPendingChanges()])
      if (
        activeSession?.selectedFile &&
        filteredPendingChanges.some(change => change.path === activeSession.selectedFile)
      ) {
        await openFile(activeSession.selectedFile, activeSession.id)
      }
      setStatus(`Applied ${filteredPendingChanges.length} filtered changes`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Apply filtered failed')
    }
  }

  async function rejectFilteredPending() {
    if (!filteredPendingChanges.length) {
      setStatus('No matching pending changes')
      return
    }

    openWorkspaceTab('changes')
    setStatus(`Rejecting ${filteredPendingChanges.length} filtered changes...`)

    try {
      await Promise.all(
        filteredPendingChanges.map(change =>
          apiFetch<{ ok: boolean }>('/api/pending-changes/reject', {
            method: 'POST',
            body: JSON.stringify({ path: change.path }),
          }),
        ),
      )
      await Promise.all([loadTree(), loadPendingChanges()])
      if (
        activeSession?.selectedFile &&
        filteredPendingChanges.some(change => change.path === activeSession.selectedFile)
      ) {
        await openFile(activeSession.selectedFile, activeSession.id)
      }
      setStatus(`Rejected ${filteredPendingChanges.length} filtered changes`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Reject filtered failed')
    }
  }

  function previewPendingChunk(change: PendingChange, chunk: DiffChunk) {
    const nextContent = applyDiffChunkToContent(change.originalContent, chunk)
    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      selectedFile: change.path,
      fileContent: nextContent,
      loadedFileContent: nextContent,
      diskFileContent: change.originalContent,
    }))
    setStatus(`Previewing ${chunk.id} for ${change.path}`)
  }

  async function applyPendingChunk(change: PendingChange, chunk: DiffChunk) {
    openWorkspaceTab('changes')
    setStatus(`Applying ${chunk.id} to ${change.path}...`)

    try {
      const nextContent = applyDiffChunkToContent(change.originalContent, chunk)
      const payload = await writeWorkspaceFile(change.path, nextContent)
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession?.selectedFile === change.path) {
        await openFile(change.path, activeSession.id)
      }
      setStatus(
        payload.mode === 'staged'
          ? `Staged ${chunk.id} for ${change.path}`
          : `Applied ${chunk.id} to ${change.path}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Chunk apply failed')
    }
  }

  function togglePendingChunkSelection(chunkId: string) {
    setSelectedChunkIds(current =>
      current.includes(chunkId)
        ? current.filter(id => id !== chunkId)
        : [...current, chunkId],
    )
  }

  function toggleAllPendingChunks() {
    if (!pendingDiffChunks.length) {
      return
    }

    setSelectedChunkIds(current =>
      current.length === pendingDiffChunks.length
        ? []
        : pendingDiffChunks.map(chunk => chunk.id),
    )
  }

  function previewSelectedPendingChunks(change: PendingChange) {
    if (!selectedPendingChunks.length) {
      setStatus('Select one or more chunks first')
      return
    }

    const nextContent = applyDiffChunksToContent(
      change.originalContent,
      selectedPendingChunks,
    )
    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      selectedFile: change.path,
      fileContent: nextContent,
      loadedFileContent: nextContent,
      diskFileContent: change.originalContent,
    }))
    setStatus(`Previewing ${selectedPendingChunks.length} selected chunks for ${change.path}`)
  }

  async function applySelectedPendingChunks(change: PendingChange) {
    if (!selectedPendingChunks.length) {
      setStatus('Select one or more chunks first')
      return
    }

    openWorkspaceTab('changes')
    setStatus(`Applying ${selectedPendingChunks.length} selected chunks to ${change.path}...`)

    try {
      const nextContent = applyDiffChunksToContent(
        change.originalContent,
        selectedPendingChunks,
      )
      const payload = await writeWorkspaceFile(change.path, nextContent)
      await Promise.all([loadTree(), loadPendingChanges()])
      setSelectedChunkIds([])
      if (activeSession?.selectedFile === change.path) {
        await openFile(change.path, activeSession.id)
      }
      setStatus(
        payload.mode === 'staged'
          ? `Staged ${selectedPendingChunks.length} chunks for ${change.path}`
          : `Applied ${selectedPendingChunks.length} chunks to ${change.path}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Selected chunk apply failed')
    }
  }

  async function copyToClipboard(copyId: string, content: string, successMessage: string) {
    if (!content.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(content)
      setCopiedItemId(copyId)
      setStatus(successMessage)
      window.setTimeout(() => {
        setCopiedItemId(current => (current === copyId ? '' : current))
      }, 1500)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to copy text')
    }
  }

  async function copyMessageContent(messageId: string, content: string) {
    await copyToClipboard(messageId, content, 'Message copied')
  }

  async function copyCodeBlock(messageId: string, blockIndex: number, code: string) {
    await copyToClipboard(`${messageId}-code-${blockIndex}`, code, 'Code block copied')
  }

  function openWorkspaceTab(tab: WorkspaceTab) {
    setDockCollapsed(false)
    setWorkspaceTab(tab)
  }

  function openCommandPalette() {
    setCommandPaletteOpen(true)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }

  function closeCommandPalette() {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }

  async function executeCommandPaletteItem(item: CommandPaletteItem) {
    closeCommandPalette()

    switch (item.action) {
      case 'new-chat-current':
        createSessionTab()
        return
      case 'save-current-project':
        saveCurrentWorkspacePreset()
        return
      case 'toggle-sidebar':
        toggleSidebarVisibility()
        return
      case 'toggle-dock':
        toggleWorkspaceDock()
        return
      case 'refresh-git':
        openWorkspaceTab('git')
        await loadGitStatus(gitSelectedPath)
        setStatus('Git status refreshed')
        return
      case 'tab':
        openWorkspaceTab(item.tab)
        setStatus(`Opened ${item.tab}`)
        return
      case 'project-open':
        await switchWorkspacePreset(item.root)
        return
      case 'project-new-chat':
        await createSessionForProject(item.root)
        return
      case 'session-open':
        if (item.root === settings?.workspaceRoot) {
          setActiveSessionId(item.sessionId)
          setStatus('Opened chat')
          return
        }
        await switchWorkspacePreset(item.root, item.sessionId)
        return
    }
  }

  function addPromptAttachment(attachment: PromptAttachment) {
    updateActiveSession(session => {
      const nextAttachments = [...(session.promptAttachments ?? []), attachment]
      return {
        ...session,
        promptAttachments: nextAttachments.slice(-MAX_ATTACHMENTS_PER_PROMPT),
      }
    })
  }

  function removePromptAttachment(attachmentId: string) {
    updateActiveSession(session => ({
      ...session,
      promptAttachments: (session.promptAttachments ?? []).filter(
        attachment => attachment.id !== attachmentId,
      ),
    }))
    setStatus('Removed attachment')
  }

  async function processPromptAttachmentFiles(files: File[]) {
    if (!files.length) {
      return
    }

    const remainingSlots = Math.max(
      0,
      MAX_ATTACHMENTS_PER_PROMPT - (activeSession?.promptAttachments?.length ?? 0),
    )

    if (!remainingSlots) {
      setStatus(`You can attach up to ${MAX_ATTACHMENTS_PER_PROMPT} files per prompt`)
      return
    }

    const acceptedFiles = files.slice(0, remainingSlots)
    let attachedText = 0
    let attachedImages = 0
    let skippedUnsupported = 0
    let skippedLarge = 0

    for (const file of acceptedFiles) {
      const imageAttachment = isImageAttachment(file)
      const sizeLimit = imageAttachment ? MAX_IMAGE_ATTACHMENT_BYTES : MAX_TEXT_ATTACHMENT_BYTES

      if (file.size > sizeLimit) {
        skippedLarge += 1
        continue
      }

      if (!imageAttachment && !isLikelyTextAttachment(file)) {
        skippedUnsupported += 1
        continue
      }

      try {
        if (imageAttachment) {
          const imageUrl = await readFileAsDataUrl(file)
          addPromptAttachment({
            id: createId(),
            kind: 'image',
            name: file.name || `image-${createId()}.png`,
            mimeType: file.type || 'image/png',
            content: '',
            imageUrl,
            detail: 'auto',
          })
          attachedImages += 1
          continue
        }

        const raw = await file.text()
        const trimmed = trimAttachmentContent(raw)
        addPromptAttachment({
          id: createId(),
          kind: 'local-file',
          name: file.name,
          mimeType: file.type || 'text/plain',
          content: trimmed.content,
          truncated: trimmed.truncated,
        })
        attachedText += 1
      } catch {
        skippedUnsupported += 1
      }
    }

    const parts = [
      attachedText
        ? `Attached ${attachedText} text file${attachedText > 1 ? 's' : ''}`
        : '',
      attachedImages
        ? `attached ${attachedImages} image${attachedImages > 1 ? 's' : ''}`
        : '',
      skippedLarge ? `skipped ${skippedLarge} oversized` : '',
      skippedUnsupported ? `skipped ${skippedUnsupported} unsupported` : '',
    ].filter(Boolean)

    if (parts.length) {
      setStatus(parts.join(' / '))
    }
  }

  function toggleSidebarVisibility() {
    setSidebarCollapsed(current => !current)
    setStatus(sidebarCollapsed ? 'Chat sidebar opened' : 'Chat sidebar collapsed')
  }

  function toggleWorkspaceDock() {
    setDockCollapsed(current => !current)
    setStatus(dockCollapsed ? 'Workspace dock opened' : 'Workspace dock collapsed')
  }

  function startDockResize() {
    setDockCollapsed(false)
    setDockResizing(true)
  }

  async function attachWorkspaceFileToPrompt(filePath: string) {
    if (!filePath) {
      return
    }

    try {
      const payload = await apiFetch<WorkspaceFilePayload>(
        `/api/workspace/file?path=${encodeURIComponent(filePath)}`,
      )
      const sourceContent = payload.pendingChange?.content ?? payload.content
      const trimmed = trimAttachmentContent(sourceContent)
      addPromptAttachment({
        id: createId(),
        kind: 'workspace-file',
        name: filePath.split(/[\\/]/).pop() ?? filePath,
        path: filePath,
        mimeType: 'text/plain',
        content: trimmed.content,
        truncated: trimmed.truncated,
      })
      setStatus(`Attached ${filePath} to this prompt`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to attach workspace file')
    }
  }

  async function attachCurrentWorkspaceFile() {
    if (!activeSession?.selectedFile) {
      openWorkspaceTab('files')
      setStatus('Open a workspace file first, then you can attach it to the chat')
      return
    }

    await attachWorkspaceFileToPrompt(activeSession.selectedFile)
  }

  function triggerAttachmentUpload() {
    attachmentInputRef.current?.click()
  }

  async function importPromptAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])]
    event.target.value = ''
    await processPromptAttachmentFiles(files)
  }

  async function handleComposerPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = [...event.clipboardData.items]
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (!files.length) {
      return
    }

    event.preventDefault()
    await processPromptAttachmentFiles(files)
  }

  function handleComposerDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    composerDragDepthRef.current += 1
    setComposerDragActive(true)
  }

  function handleComposerDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (!composerDragActive) {
      setComposerDragActive(true)
    }
  }

  function handleComposerDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }

    event.preventDefault()
    composerDragDepthRef.current = Math.max(0, composerDragDepthRef.current - 1)
    if (!composerDragDepthRef.current) {
      setComposerDragActive(false)
    }
  }

  async function handleComposerDrop(event: ReactDragEvent<HTMLDivElement>) {
    if (!event.dataTransfer.files.length) {
      return
    }

    event.preventDefault()
    composerDragDepthRef.current = 0
    setComposerDragActive(false)
    await processPromptAttachmentFiles([...event.dataTransfer.files])
  }

  function previewCodeBlockPatch(code: string, label = 'Code block patch') {
    if (!activeSession?.selectedFile) {
      openWorkspaceTab('files')
      setStatus('Open a file first, then you can preview a code block as a patch')
      return
    }

    updateActiveSession(session => ({
      ...session,
      draftPatch: {
        path: session.selectedFile,
        content: code,
        sourceLabel: label,
        createdAt: new Date().toISOString(),
      } satisfies DraftPatchPreview,
    }))
    openWorkspaceTab('changes')
    setStatus(`Prepared a draft patch for ${activeSession.selectedFile}`)
  }

  function discardDraftPatch() {
    updateActiveSession(session => ({
      ...session,
      draftPatch: null,
    }))
    setStatus('Discarded draft patch')
  }

  function loadDraftPatchIntoEditor() {
    if (!activeDraftPatch) {
      return
    }

    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      fileContent: activeDraftPatch.content,
    }))
    setStatus(`Loaded draft patch for ${activeDraftPatch.path} into the editor`)
  }

  async function stageDraftPatch() {
    if (!activeDraftPatch) {
      setStatus('No draft patch to stage')
      return
    }

    openWorkspaceTab('changes')
    setStatus(
      `${settings?.safeWriteMode ? 'Staging' : 'Writing'} draft patch for ${activeDraftPatch.path}...`,
    )

    try {
      const payload = await writeWorkspaceFile(activeDraftPatch.path, activeDraftPatch.content)
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession) {
        await openFile(activeDraftPatch.path, activeSession.id)
      }
      updateActiveSession(session => ({
        ...session,
        draftPatch: null,
      }))
      setStatus(
        payload.mode === 'staged'
          ? `Staged draft patch for ${activeDraftPatch.path}`
          : `Wrote draft patch to ${activeDraftPatch.path}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to apply draft patch')
    }
  }

  function toggleDraftChunkSelection(chunkId: string) {
    setSelectedDraftChunkIds(current =>
      current.includes(chunkId)
        ? current.filter(id => id !== chunkId)
        : [...current, chunkId],
    )
  }

  function toggleAllDraftChunks() {
    if (!draftPatchChunks.length) {
      return
    }

    setSelectedDraftChunkIds(current =>
      current.length === draftPatchChunks.length ? [] : draftPatchChunks.map(chunk => chunk.id),
    )
  }

  function previewSelectedDraftChunks() {
    if (!activeDraftPatch || !selectedDraftChunks.length) {
      setStatus('Select one or more draft chunks first')
      return
    }

    const nextContent = applyDiffChunksToContent(
      activeSession?.diskFileContent ?? '',
      selectedDraftChunks,
    )
    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      fileContent: nextContent,
    }))
    setStatus(`Previewing ${selectedDraftChunks.length} draft chunk(s) for ${activeDraftPatch.path}`)
  }

  function narrowDraftToSelectedChunks() {
    if (!activeDraftPatch || !selectedDraftChunks.length) {
      setStatus('Select one or more draft chunks first')
      return
    }

    const nextContent = applyDiffChunksToContent(
      activeSession?.diskFileContent ?? '',
      selectedDraftChunks,
    )
    updateActiveSession(session => ({
      ...session,
      draftPatch: session.draftPatch
        ? {
            ...session.draftPatch,
            content: nextContent,
            sourceLabel: `${session.draftPatch.sourceLabel} (filtered)`,
            createdAt: new Date().toISOString(),
          }
        : session.draftPatch,
    }))
    setSelectedDraftChunkIds([])
    setStatus(`Draft patch narrowed to ${selectedDraftChunks.length} selected chunk(s)`)
  }

  async function stageSelectedDraftChunks() {
    if (!activeDraftPatch || !selectedDraftChunks.length) {
      setStatus('Select one or more draft chunks first')
      return
    }

    const nextContent = applyDiffChunksToContent(
      activeSession?.diskFileContent ?? '',
      selectedDraftChunks,
    )
    openWorkspaceTab('changes')
    setStatus(
      `${settings?.safeWriteMode ? 'Staging' : 'Writing'} ${selectedDraftChunks.length} selected draft chunk(s)...`,
    )

    try {
      const payload = await writeWorkspaceFile(activeDraftPatch.path, nextContent)
      await Promise.all([loadTree(), loadPendingChanges()])
      if (activeSession) {
        await openFile(activeDraftPatch.path, activeSession.id)
      }
      setStatus(
        payload.mode === 'staged'
          ? `Staged ${selectedDraftChunks.length} selected draft chunk(s)`
          : `Wrote ${selectedDraftChunks.length} selected draft chunk(s)`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to apply selected draft chunks')
    }
  }

  function applyCodeBlockToEditor(code: string) {
    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      fileContent: code,
    }))
    setStatus(
      activeSession?.selectedFile
        ? `Inserted code into ${activeSession.selectedFile}`
        : 'Inserted code into the editor buffer. Open a file before saving.',
    )
  }

  async function stageCodeBlockToCurrentFile(code: string) {
    if (!activeSession?.selectedFile) {
      openWorkspaceTab('files')
      setStatus('Open a file first, then you can stage a code block as a patch')
      return
    }

    const targetPath = activeSession.selectedFile
    const sessionId = activeSession.id
    openWorkspaceTab('changes')
    setStatus(
      `${settings?.safeWriteMode ? 'Staging' : 'Writing'} code block to ${targetPath}...`,
    )

    try {
      const payload = await writeWorkspaceFile(targetPath, code)
      await Promise.all([loadTree(), loadPendingChanges()])
      await openFile(targetPath, sessionId)
      openWorkspaceTab(payload.mode === 'staged' ? 'changes' : 'editor')
      setStatus(
        payload.mode === 'staged'
          ? `Staged code block for ${targetPath}`
          : `Wrote code block to ${targetPath}`,
      )
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to stage code block')
    }
  }

  function toggleTheme() {
    setTheme(current => (current === 'light' ? 'dark' : 'light'))
  }

  function exportSessionsArchive() {
    if (!sessions.length) {
      setStatus('No chats to export')
      return
    }

    const archive: SessionArchive = {
      version: 1,
      exportedAt: new Date().toISOString(),
      activeSessionId,
      sessions,
    }
    const blob = new Blob([JSON.stringify(archive, null, 2)], {
      type: 'application/json',
    })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `roycode-studio-chats-${new Date()
      .toISOString()
      .replace(/[:.]/g, '-')}.json`
    anchor.click()
    window.URL.revokeObjectURL(url)
    setStatus(`Exported ${sessions.length} chats`)
  }

  function triggerImportArchive() {
    importInputRef.current?.click()
  }

  async function importSessionsArchive(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !settings) {
      return
    }

    try {
      const content = await file.text()
      const parsed = JSON.parse(content) as
        | SessionArchive
        | Array<Partial<SessionState>>
        | { sessions?: Array<Partial<SessionState>> }
      const archiveSessions = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.sessions)
          ? parsed.sessions
          : []

      if (!archiveSessions.length) {
        throw new Error('No chats found in that archive')
      }

      const importedSessions = normalizeImportedSessions(archiveSessions, settings)
      setSessions(previous => [...importedSessions, ...previous])
      setActiveSessionId(importedSessions[0]!.id)
      setSessionFilter('')
      setStatus(`Imported ${importedSessions.length} chats`)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to import chat archive')
    }
  }

  function saveCurrentWorkspacePreset() {
    if (!settings) {
      return
    }

    setWorkspacePresets(previous =>
      upsertWorkspacePreset(previous, settings.workspaceRoot, getWorkspaceLabel(settings.workspaceRoot)),
    )
    setStatus(`Saved ${getWorkspaceLabel(settings.workspaceRoot)} to projects`)
  }

  function toggleWorkspacePresetFavorite(root: string, name?: string) {
    const normalizedRoot = root.trim()
    if (!normalizedRoot) {
      return
    }

    let nextFavorite = false
    setWorkspacePresets(previous => {
      const existing = previous.find(
        preset => preset.root.toLowerCase() === normalizedRoot.toLowerCase(),
      )

      if (!existing) {
        nextFavorite = true
        return upsertWorkspacePreset(previous, normalizedRoot, name).map(preset =>
          preset.root.toLowerCase() === normalizedRoot.toLowerCase()
            ? {
                ...preset,
                favorite: true,
              }
            : preset,
        )
      }

      nextFavorite = !existing.favorite
      return previous.map(preset =>
        preset.root.toLowerCase() === normalizedRoot.toLowerCase()
          ? {
              ...preset,
              favorite: !preset.favorite,
            }
          : preset,
      )
    })

    setStatus(nextFavorite ? 'Project added to favorites' : 'Project removed from favorites')
  }

  function toggleProjectRailExpansion(root: string) {
    setExpandedProjectRoots(current =>
      current.includes(root) ? current.filter(item => item !== root) : [...current, root],
    )
  }

  function renameWorkspacePreset(presetId: string, name: string) {
    setWorkspacePresets(previous =>
      previous.map(preset =>
        preset.id === presetId
          ? {
              ...preset,
              name: name.trimStart() || getWorkspaceLabel(preset.root),
            }
          : preset,
      ),
    )
  }

  function removeWorkspacePreset(presetId: string) {
    setWorkspacePresets(previous => previous.filter(preset => preset.id !== presetId))
    setStatus('Removed project card')
  }

  async function switchWorkspacePreset(
    root: string,
    focusSessionId?: string,
    sourceSessions = sessions,
  ) {
    if (!settings) {
      return
    }

    if (root === settings.workspaceRoot) {
      if (focusSessionId) {
        setActiveSessionId(focusSessionId)
        setStatus('Opened chat in the current project')
        return
      }
      openWorkspaceTab('projects')
      setStatus('This project is already open')
      return
    }

    openWorkspaceTab('projects')
    setStatus(`Switching to ${getWorkspaceLabel(root)}...`)

    try {
      const nextSettings = await persistSettings({ workspaceRoot: root })
      applySettingsFromResponse(nextSettings, sourceSessions)
      await Promise.all([loadTree(), loadPendingChanges()])
      if (focusSessionId) {
        setActiveSessionId(focusSessionId)
        setStatus(`Switched to ${getWorkspaceLabel(root)} / opened chat`)
      } else {
        setStatus(`Switched to ${getWorkspaceLabel(root)}`)
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Failed to switch workspace')
    }
  }

  function applyCodeBlockToCurrentFile(code: string) {
    if (!activeSession?.selectedFile) {
      openWorkspaceTab('files')
      setStatus('Open a file first, then you can replace it from a code block')
      return
    }

    openWorkspaceTab('editor')
    updateActiveSession(session => ({
      ...session,
      fileContent: code,
    }))
    setStatus(`Applied code block to ${activeSession.selectedFile}. Review the diff before saving.`)
  }

  useEffect(() => {
    void loadWorkspace()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, theme)
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        sidebarCollapsed,
        dockCollapsed,
        dockWidth,
      } satisfies LayoutPrefs),
    )
  }, [sidebarCollapsed, dockCollapsed, dockWidth])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      WORKSPACE_PRESET_STORAGE_KEY,
      JSON.stringify(workspacePresets),
    )
  }, [workspacePresets])

  useEffect(() => {
    if (!sessions.length || typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        sessions,
        activeSessionId,
      }),
    )
  }, [sessions, activeSessionId])

  useEffect(() => {
    if (!workspaceSessions.length) {
      return
    }
    if (!workspaceSessions.some(item => item.id === activeSessionId)) {
      setActiveSessionId(workspaceSessions[0]!.id)
    }
  }, [workspaceSessions, activeSessionId])

  useEffect(() => {
    if (!filteredPendingChanges.length) {
      if (selectedPendingPath) {
        setSelectedPendingPath('')
      }
      return
    }

    if (
      selectedPendingPath &&
      filteredPendingChanges.some(item => item.path === selectedPendingPath)
    ) {
      return
    }

    if (
      activePendingChange &&
      filteredPendingChanges.some(item => item.path === activePendingChange.path)
    ) {
      setSelectedPendingPath(activePendingChange.path)
      return
    }

    setSelectedPendingPath(filteredPendingChanges[0]!.path)
  }, [filteredPendingChanges, selectedPendingPath, activePendingChange])

  useEffect(() => {
    setSelectedChunkIds([])
  }, [selectedPendingChange?.path])

  useEffect(() => {
    setSelectedChunkIds(current =>
      current.filter(chunkId => pendingDiffChunks.some(chunk => chunk.id === chunkId)),
    )
  }, [pendingDiffChunks])

  useEffect(() => {
    setSelectedDraftChunkIds([])
  }, [activeDraftPatch?.path, activeDraftPatch?.content])

  useEffect(() => {
    setSelectedDraftChunkIds(current =>
      current.filter(chunkId => draftPatchChunks.some(chunk => chunk.id === chunkId)),
    )
  }, [draftPatchChunks])

  useEffect(() => {
    if (!commandPaletteOpen) {
      return
    }

    setCommandPaletteIndex(current =>
      visibleCommandPaletteItems.length
        ? Math.min(current, visibleCommandPaletteItems.length - 1)
        : 0,
    )
  }, [visibleCommandPaletteItems, commandPaletteOpen])

  useEffect(() => {
    if (!commandPaletteOpen) {
      return
    }

    window.setTimeout(() => {
      commandPaletteInputRef.current?.focus()
      commandPaletteInputRef.current?.select()
    }, 0)
  }, [commandPaletteOpen])

  useEffect(() => {
    const node = chatScrollRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [latestMessageKey])

  useEffect(() => {
    if (activeSession?.archived) {
      setShowArchivedSessions(true)
    }
  }, [activeSession?.archived])

  useEffect(() => {
    if (!settings?.workspaceRoot) {
      return
    }

    setExpandedProjectRoots(current =>
      current.includes(settings.workspaceRoot)
        ? current
        : [settings.workspaceRoot, ...current].slice(0, 16),
    )
  }, [settings?.workspaceRoot])

  useEffect(() => {
    setSessionTagDraft((activeSession?.tags ?? []).join(', '))
  }, [activeSession?.id, activeSession?.tags])

  useEffect(() => {
    if (
      draggingSessionId &&
      !workspaceSessions.some(session => session.id === draggingSessionId)
    ) {
      setDraggingSessionId('')
      setDropSessionId('')
    }
  }, [workspaceSessions, draggingSessionId])

  useEffect(() => {
    if (!dockResizing) {
      return
    }

    function handlePointerMove(event: MouseEvent) {
      const frame = workspaceFrameRef.current
      if (!frame) {
        return
      }

      const frameBounds = frame.getBoundingClientRect()
      const nextWidth = clampNumber(
        frameBounds.right - event.clientX,
        320,
        Math.min(760, Math.max(320, frameBounds.width - 280)),
      )
      setDockWidth(nextWidth)
      if (dockCollapsed) {
        setDockCollapsed(false)
      }
    }

    function stopResize() {
      setDockResizing(false)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }

    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('mouseup', stopResize)

    return () => {
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('mouseup', stopResize)
    }
  }, [dockResizing, dockCollapsed])

  useEffect(() => {
    function handleGlobalKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        openCommandPalette()
        return
      }

      const target = event.target as HTMLElement | null
      const isTypingTarget =
        Boolean(target?.isContentEditable) ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'

      if (isTypingTarget) {
        return
      }

      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        setSidebarCollapsed(current => !current)
        return
      }

      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey) {
        return
      }

      const hotkey = event.key.toLowerCase()
      if (hotkey === 'g') {
        event.preventDefault()
        openWorkspaceTab('git')
        void loadGitStatus(gitSelectedPath)
        return
      }

      if (hotkey === 'd') {
        event.preventDefault()
        setDockCollapsed(current => !current)
        return
      }

      const tabMap: Partial<Record<string, WorkspaceTab>> = {
        f: 'files',
        e: 'editor',
        c: 'changes',
        t: 'terminal',
        p: 'projects',
        m: 'providers',
        ',': 'settings',
      }
      const nextTab = tabMap[hotkey]
      if (!nextTab) {
        return
      }

      event.preventDefault()
      openWorkspaceTab(nextTab)
    }

    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown)
    }
  }, [])

  function renderSettingsPanel() {
    return (
      <section className="dock-card">
        <div className="section-head">
          <div>
            <h2>Workspace Settings</h2>
            <div className="muted-text">Backend defaults for the assistant and tools.</div>
          </div>
          {isDesktopShell ? <span className="badge">Desktop</span> : null}
        </div>

        <div className="field">
          <div className="section-head compact-section-head">
            <span>Workspace Root</span>
            {isDesktopShell ? (
              <button className="ghost-button subtle-button" onClick={() => void pickDesktopWorkspaceFolder()}>
                Pick Folder
              </button>
            ) : null}
          </div>
          <input
            value={workspaceRootDraft}
            onChange={event => setWorkspaceRootDraft(event.target.value)}
          />
        </div>

        <label className="field">
          <span>Filesystem Access</span>
          <select
            value={accessModeDraft}
            onChange={event => setAccessModeDraft(event.target.value as AccessMode)}
          >
            <option value="workspace">Workspace only</option>
            <option value="unrestricted">Unrestricted local access</option>
          </select>
          <div className="muted-text">
            {accessModeDraft === 'unrestricted'
              ? 'AI tools may read, write, and run commands outside the workspace root. Use this only on your own machine.'
              : 'AI tools stay inside the configured workspace root.'}
          </div>
        </label>

        <label className="field">
          <span>System Prompt</span>
          <textarea
            rows={5}
            value={systemPromptDraft}
            onChange={event => setSystemPromptDraft(event.target.value)}
          />
        </label>

        <div className="field-grid">
          <label className="field">
            <span>Command Timeout (ms)</span>
            <input
              value={commandTimeoutDraft}
              onChange={event => setCommandTimeoutDraft(event.target.value)}
            />
          </label>
          <label className="field">
            <span>Max Agent Steps</span>
            <input
              value={maxStepsDraft}
              onChange={event => setMaxStepsDraft(event.target.value)}
            />
          </label>
        </div>

        <label className="toggle-row">
          <input
            type="checkbox"
            checked={safeWriteModeDraft}
            onChange={event => setSafeWriteModeDraft(event.target.checked)}
          />
          <div>
            <strong>Safe write mode</strong>
            <div className="muted-text">
              File edits are staged first and only written after approval.
            </div>
          </div>
        </label>

        <button className="primary-button full-width" onClick={() => void saveGlobalSettings()}>
          Save Settings
        </button>
      </section>
    )
  }

  function renderProvidersPanel() {
    const providerList = settings?.providers ?? []

    return (
      <section className="dock-card">
        <div className="section-head">
          <div>
            <h2>Models & APIs</h2>
            <div className="muted-text">
              Add providers, manage API keys, and edit supported model lists.
            </div>
          </div>
        </div>

        <div className="preset-grid">
          {presets.map(preset => (
            <button
              key={preset.id}
              className="preset-card"
              onClick={() => void addPreset(preset.id)}
            >
              <strong>{preset.name}</strong>
              <small>{preset.description}</small>
              <small>{preset.baseUrl}</small>
            </button>
          ))}
        </div>

        <div className="provider-list">
          {providerList.map(provider => {
            const draft = providerDrafts[provider.id]
            if (!draft) {
              return null
            }

            const models = parseModelsText(draft.modelsText)
            const active = activeSession.providerId === provider.id

            return (
              <div
                key={provider.id}
                className={`provider-card ${active ? 'provider-card-active' : ''}`}
              >
                <div className="provider-topline">
                  <button
                    className="provider-title"
                    onClick={() =>
                      updateActiveSession(session => ({
                        ...session,
                        providerId: provider.id,
                        model:
                          models.includes(session.model)
                            ? session.model
                            : draft.defaultModel || models[0] || '',
                      }))
                    }
                  >
                    {draft.name}
                  </button>
                  <span className="status-pill">
                    {provider.hasApiKey ? 'API Key ready' : 'API Key missing'}
                  </span>
                </div>

                <div className="badge-row">
                  {(models.length ? models : ['No models']).map(model => (
                    <span key={model} className="badge">
                      {model}
                    </span>
                  ))}
                </div>

                <label className="field">
                  <span>Name</span>
                  <input
                    value={draft.name}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Base URL</span>
                  <input
                    value={draft.baseUrl}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    placeholder="Only fill this when updating"
                    value={draft.apiKeyInput}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        apiKeyInput: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Supported Models</span>
                  <textarea
                    rows={4}
                    value={draft.modelsText}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        modelsText: event.target.value,
                      }))
                    }
                  />
                </label>

                <label className="field">
                  <span>Default Model</span>
                  <select
                    value={draft.defaultModel ?? models[0] ?? ''}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        defaultModel: event.target.value,
                      }))
                    }
                  >
                    {(models.length ? models : ['']).map(model => (
                      <option key={model} value={model}>
                        {model || 'No models'}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Notes</span>
                  <textarea
                    rows={3}
                    value={draft.notes ?? ''}
                    onChange={event =>
                      updateProviderDraft(provider.id, current => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </label>

                <div className="provider-actions">
                  <button className="primary-button" onClick={() => void saveProvider(provider.id)}>
                    Save
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => void refreshProviderModels(provider.id)}
                  >
                    Refresh Models
                  </button>
                  <button
                    className="ghost-button danger"
                    onClick={() => void removeProvider(provider.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    )
  }

  function renderProjectsPanel() {
    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Projects</h2>
            <div className="muted-text">
              Keep a local list of workspaces and switch between them in one click.
            </div>
          </div>
          <div className="provider-actions">
            <button className="ghost-button" onClick={() => openWorkspaceTab('settings')}>
              Edit Root
            </button>
            <button className="primary-button" onClick={saveCurrentWorkspacePreset}>
              Save Current
            </button>
          </div>
        </div>

        <article className="project-hero">
          <div className="eyebrow">Active Workspace</div>
          <h3>{settings ? getWorkspaceLabel(settings.workspaceRoot) : 'Workspace'}</h3>
          <p>{settings?.workspaceRoot}</p>
          <div className="badge-row">
            <span className="badge">{workspaceSessions.length} chats</span>
            <span className="badge">{visibleFiles.length} files</span>
            <span className="badge">{pendingChanges.length} pending</span>
          </div>
        </article>

        <label className="field">
          <span>Search Projects</span>
          <input
            value={projectFilter}
            onChange={event => setProjectFilter(event.target.value)}
            placeholder="Find a saved project"
          />
        </label>

        <div className="project-list dock-scroll">
          {filteredWorkspacePresets.length ? (
            filteredWorkspacePresets.map(preset => {
              const active = preset.root === settings?.workspaceRoot

              return (
                <article
                  key={preset.id}
                  className={`project-card ${active ? 'project-card-active' : ''}`}
                >
                  <label className="field">
                    <span>Project Name</span>
                    <input
                      value={preset.name}
                      onChange={event => renameWorkspacePreset(preset.id, event.target.value)}
                    />
                  </label>
                  <div className="muted-text">{preset.root}</div>
                  <div className="muted-text">Last used {formatTime(preset.lastUsedAt)}</div>
                  <div className="project-card-actions">
                    <button
                      className={`ghost-button ${preset.favorite ? 'project-favorite-active' : ''}`}
                      onClick={() => toggleWorkspacePresetFavorite(preset.root, preset.name)}
                    >
                      {preset.favorite ? 'Favorite' : 'Star'}
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void switchWorkspacePreset(preset.root)}
                      disabled={active}
                    >
                      {active ? 'Open now' : 'Open project'}
                    </button>
                    <button
                      className="ghost-button danger"
                      onClick={() => removeWorkspacePreset(preset.id)}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              )
            })
          ) : (
            <div className="empty-state">
              {projectFilter.trim()
                ? 'No saved projects match this search.'
                : 'Save your current workspace to start building a reusable project switcher.'}
            </div>
          )}
        </div>
      </section>
    )
  }

  function renderFilesPanel() {
    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Files</h2>
            <div className="muted-text">
              {settings?.accessMode === 'unrestricted'
                ? treeRootDraft || settings?.workspaceRoot
                : settings?.workspaceRoot}
            </div>
          </div>
          <div className="provider-actions">
            <span className="badge">
              {settings?.accessMode === 'unrestricted' ? 'Full access' : 'Workspace'}
            </span>
            <span className="badge">{filteredFiles.length}</span>
          </div>
        </div>

        {settings?.accessMode === 'unrestricted' ? (
          <div className="field">
            <div className="section-head compact-section-head">
              <span>Browse Path</span>
              <div className="provider-actions">
                {isDesktopShell ? (
                  <button
                    className="ghost-button subtle-button"
                    onClick={() => void browseTreeRoot(true)}
                  >
                    Pick Folder
                  </button>
                ) : null}
                <button
                  className="ghost-button subtle-button"
                  onClick={() => {
                    setTreeRootDraft(settings.workspaceRoot)
                    void loadTree({
                      path: settings.workspaceRoot,
                      accessMode: settings.accessMode,
                      workspaceRoot: settings.workspaceRoot,
                    })
                  }}
                >
                  Go Workspace Root
                </button>
              </div>
            </div>
            <div className="inline-action-row">
              <input
                value={treeRootDraft}
                onChange={event => setTreeRootDraft(event.target.value)}
                placeholder="C:\\Users\\Roy or any absolute path"
              />
              <button className="ghost-button" onClick={() => void browseTreeRoot()}>
                Browse
              </button>
            </div>
            <div className="muted-text">
              Absolute paths are allowed in unrestricted mode.
            </div>
          </div>
        ) : null}

        <label className="field">
          <span>Filter Files</span>
          <input
            value={fileFilter}
            onChange={event => setFileFilter(event.target.value)}
            placeholder="Search files by path"
          />
        </label>

        <div className="file-tree dock-scroll">
          {filteredFiles.length ? (
            filteredFiles.map(file => (
              <button
                key={file.path}
                className={`file-item ${
                  file.path === activeSession?.selectedFile ? 'file-item-active' : ''
                }`}
                onClick={() => void openFile(file.path)}
              >
                {file.path}
              </button>
            ))
          ) : (
            <div className="empty-state">No matching files.</div>
          )}
        </div>
      </section>
    )
  }

  function renderEditorPanel() {
    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Editor</h2>
            <div className="muted-text">
              {activeSession?.selectedFile || 'Select a file to edit'}
            </div>
          </div>
          <div className="provider-actions">
            {activePendingChange ? <span className="status-pill">Pending write</span> : null}
            {editorDirty ? <span className="badge">Unsaved</span> : null}
            {isDesktopShell ? (
              <button
                className="ghost-button"
                onClick={() => void revealSelectedFileInDesktop()}
                disabled={!activeSession?.selectedFile}
              >
                Reveal
              </button>
            ) : null}
            <button
              className="ghost-button"
              onClick={() =>
                activeSession?.selectedFile
                  ? void openFile(activeSession.selectedFile)
                  : undefined
              }
              disabled={!activeSession?.selectedFile || fileBusy}
            >
              Reload
            </button>
            <button
              className="primary-button"
              onClick={() => void saveCurrentFile()}
              disabled={!activeSession?.selectedFile || fileBusy}
            >
              {settings?.safeWriteMode ? 'Stage Change' : 'Save File'}
            </button>
          </div>
        </div>

        <textarea
          className="editor-textarea dock-editor"
          value={activeSession?.fileContent ?? ''}
          onChange={event =>
            updateActiveSession(session => ({
              ...session,
              fileContent: event.target.value,
            }))
          }
          placeholder="Open a text file from the workspace to edit it here."
        />

        <div className="dock-subsection">
          <div className="section-head">
            <div>
              <h2>Diff Preview</h2>
              <div className="muted-text">
                Comparing disk content with the current editor buffer.
              </div>
            </div>
            <span className="badge">{changedLineCount} changed lines</span>
          </div>

          <div className="diff-view dock-scroll">
            {activeSession?.selectedFile ? (
              visibleDiffLines.length ? (
                visibleDiffLines.map((line, index) => (
                  <div
                    key={`${line.leftNumber ?? 'L'}-${line.rightNumber ?? 'R'}-${index}`}
                    className={`diff-line diff-${line.type}`}
                  >
                    <span className="diff-number">{line.leftNumber ?? ''}</span>
                    <span className="diff-number">{line.rightNumber ?? ''}</span>
                    <code>{line.text || ' '}</code>
                  </div>
                ))
              ) : (
                <div className="empty-state">No changes to preview.</div>
              )
            ) : (
              <div className="empty-state">Open a file to see its diff preview.</div>
            )}
            {diffLines.length > visibleDiffLines.length ? (
              <div className="diff-truncation">
                Showing the first {visibleDiffLines.length} diff rows.
              </div>
            ) : null}
          </div>
        </div>
      </section>
    )
  }

  function renderChangesPanel() {
    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Pending Changes</h2>
            <div className="muted-text">
              Review AI and manual edits before they touch disk.
            </div>
          </div>
          <div className="pending-toolbar">
            <button className="ghost-button" onClick={() => void applyFilteredPending()}>
              Apply Visible
            </button>
            <button className="ghost-button danger" onClick={() => void rejectFilteredPending()}>
              Reject Visible
            </button>
            <button className="primary-button" onClick={() => void applyAllPending()}>
              Apply All
            </button>
          </div>
        </div>

        <div className="pending-summary-bar">
          <span className="badge">{pendingChangeCounts.all} total</span>
          <span className="badge">{pendingChangeCounts.agent} AI</span>
          <span className="badge">{pendingChangeCounts.manual} manual</span>
        </div>

        <div className="pending-filter-row">
          {(
            [
              ['all', `All (${pendingChangeCounts.all})`],
              ['agent', `AI (${pendingChangeCounts.agent})`],
              ['manual', `Manual (${pendingChangeCounts.manual})`],
            ] as const
          ).map(([filterId, label]) => (
            <button
              key={filterId}
              className={`filter-chip ${
                changeSourceFilter === filterId ? 'filter-chip-active' : ''
              }`}
              onClick={() => setChangeSourceFilter(filterId)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeDraftPatch ? (
          <div className="draft-patch-panel dock-subsection">
            <div className="pending-preview-head">
              <div>
                <h3>Draft Patch Preview</h3>
                <div className="pending-meta">
                  {activeDraftPatch.sourceLabel} / {activeDraftPatch.path} /{' '}
                  {formatTime(activeDraftPatch.createdAt)}
                </div>
              </div>
              <div className="pending-preview-actions">
                <button className="ghost-button" onClick={loadDraftPatchIntoEditor}>
                  Use In Editor
                </button>
                <button className="primary-button" onClick={() => void stageDraftPatch()}>
                  {settings?.safeWriteMode ? 'Stage Draft' : 'Write Draft'}
                </button>
                <button className="ghost-button danger" onClick={discardDraftPatch}>
                  Discard Draft
                </button>
              </div>
            </div>

            <div className="pending-stats">
              <span className="badge">+{draftPatchSummary.additions}</span>
              <span className="badge">-{draftPatchSummary.removals}</span>
              <span className="badge">{draftPatchSummary.changes} changed rows</span>
            </div>

            <div className="diff-view pending-diff-view dock-scroll">
              {visibleDraftPatchLines.length ? (
                visibleDraftPatchLines.map((line, index) => (
                  <div
                    key={`draft-${line.leftNumber ?? 'L'}-${line.rightNumber ?? 'R'}-${index}`}
                    className={`diff-line diff-${line.type}`}
                  >
                    <span className="diff-number">{line.leftNumber ?? ''}</span>
                    <span className="diff-number">{line.rightNumber ?? ''}</span>
                    <code>{line.text || ' '}</code>
                  </div>
                ))
              ) : (
                <div className="empty-state">No diff detected for the current draft patch.</div>
              )}
              {draftPatchDiffLines.length > visibleDraftPatchLines.length ? (
                <div className="diff-truncation">
                  Showing the first {visibleDraftPatchLines.length} draft diff rows.
                </div>
              ) : null}
            </div>

            <div className="dock-subsection">
              <div className="section-head">
                <div>
                  <h2>Draft Chunks</h2>
                  <div className="muted-text">
                    Filter the draft down to specific hunks before it enters approval.
                  </div>
                </div>
                <div className="section-actions">
                  <span className="badge">{draftPatchChunks.length} chunks</span>
                  {selectedDraftChunkIds.length ? (
                    <span className="badge">{selectedDraftChunkIds.length} selected</span>
                  ) : null}
                  <button
                    className="ghost-button"
                    onClick={toggleAllDraftChunks}
                    disabled={!draftPatchChunks.length}
                  >
                    {draftPatchChunks.length &&
                    selectedDraftChunkIds.length === draftPatchChunks.length
                      ? 'Clear all'
                      : 'Select all'}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={previewSelectedDraftChunks}
                    disabled={!selectedDraftChunkIds.length}
                  >
                    Preview Selected
                  </button>
                  <button
                    className="ghost-button"
                    onClick={narrowDraftToSelectedChunks}
                    disabled={!selectedDraftChunkIds.length}
                  >
                    Keep Selected
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void stageSelectedDraftChunks()}
                    disabled={!selectedDraftChunkIds.length}
                  >
                    {settings?.safeWriteMode ? 'Stage Selected' : 'Write Selected'}
                  </button>
                </div>
              </div>

              <div className="chunk-list">
                {draftPatchChunks.length ? (
                  draftPatchChunks.map(chunk => (
                    <article
                      key={`draft-${chunk.id}`}
                      className={`chunk-card ${
                        selectedDraftChunkIds.includes(chunk.id) ? 'chunk-card-selected' : ''
                      }`}
                    >
                      <div className="chunk-card-head">
                        <div>
                          <strong>{chunk.id}</strong>
                          <div className="muted-text">
                            +{chunk.additions} / -{chunk.removals}
                          </div>
                        </div>
                        <div className="chunk-card-actions">
                          <button
                            className={`ghost-button ${
                              selectedDraftChunkIds.includes(chunk.id)
                                ? 'chunk-toggle-active'
                                : ''
                            }`}
                            onClick={() => toggleDraftChunkSelection(chunk.id)}
                          >
                            {selectedDraftChunkIds.includes(chunk.id) ? 'Selected' : 'Select'}
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => {
                              const nextContent = applyDiffChunkToContent(
                                activeSession?.diskFileContent ?? '',
                                chunk,
                              )
                              updateActiveSession(session => ({
                                ...session,
                                draftPatch: session.draftPatch
                                  ? {
                                      ...session.draftPatch,
                                      content: nextContent,
                                      sourceLabel: `${activeDraftPatch.sourceLabel} / ${chunk.id}`,
                                      createdAt: new Date().toISOString(),
                                    }
                                  : session.draftPatch,
                              }))
                              setStatus(`Draft narrowed to ${chunk.id}`)
                            }}
                          >
                            Make Draft
                          </button>
                        </div>
                      </div>

                      <div className="diff-view chunk-diff-view">
                        {chunk.lines.map((line, index) => (
                          <div
                            key={`draft-${chunk.id}-${line.leftNumber ?? 'L'}-${line.rightNumber ?? 'R'}-${index}`}
                            className={`diff-line diff-${line.type}`}
                          >
                            <span className="diff-number">{line.leftNumber ?? ''}</span>
                            <span className="diff-number">{line.rightNumber ?? ''}</span>
                            <code>{line.text || ' '}</code>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No draft chunks detected.</div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className="pending-list dock-scroll">
          {filteredPendingChanges.length ? (
            filteredPendingChanges.map(change => {
              const summary = summarizeDiffLines(
                buildLineDiff(change.originalContent, change.content),
              )

              return (
                <article
                  key={change.path}
                  className={`pending-card ${
                    selectedPendingChange?.path === change.path
                      ? 'pending-card-active'
                      : ''
                  }`}
                  onClick={() => setSelectedPendingPath(change.path)}
                >
                  <div className="pending-head">
                    <button
                      className="provider-title"
                      onClick={() => void openFile(change.path)}
                    >
                      {change.path}
                    </button>
                    <span className="badge">{change.source}</span>
                  </div>
                  <div className="pending-meta">{formatTime(change.updatedAt)}</div>
                  <div className="pending-stats">
                    <span className="badge">+{summary.additions}</span>
                    <span className="badge">-{summary.removals}</span>
                    <span className="badge">{summary.changes} lines</span>
                  </div>
                  <div className="pending-actions">
                    <button
                      className="ghost-button"
                      onClick={() => void openFile(change.path)}
                    >
                      Open
                    </button>
                    <button
                      className="primary-button"
                      onClick={() => void applyPending(change.path)}
                    >
                      Apply
                    </button>
                    <button
                      className="ghost-button danger"
                      onClick={() => void rejectPending(change.path)}
                    >
                      Reject
                    </button>
                  </div>
                </article>
              )
            })
          ) : (
            <div className="empty-state">No pending changes match this filter.</div>
          )}
        </div>

        {selectedPendingChange ? (
          <div className="pending-preview dock-subsection">
            <div className="pending-preview-head">
              <div>
                <h3>{selectedPendingChange.path}</h3>
                <div className="pending-meta visually-hidden">
                  {selectedPendingChange.source} · {formatTime(selectedPendingChange.updatedAt)}
                </div>
                <div className="pending-meta">
                  {selectedPendingChange.source} / {formatTime(selectedPendingChange.updatedAt)}
                </div>
              </div>
              <div className="pending-preview-actions">
                <button
                  className="ghost-button"
                  onClick={() => void openFile(selectedPendingChange.path)}
                >
                  Open In Editor
                </button>
                <button
                  className="primary-button"
                  onClick={() => void applyPending(selectedPendingChange.path)}
                >
                  Apply
                </button>
                <button
                  className="ghost-button danger"
                  onClick={() => void rejectPending(selectedPendingChange.path)}
                >
                  Reject
                </button>
              </div>
            </div>

            <div className="pending-stats">
              <span className="badge">+{pendingDiffSummary.additions}</span>
              <span className="badge">-{pendingDiffSummary.removals}</span>
              <span className="badge">{pendingDiffSummary.changes} changed rows</span>
            </div>

            <div className="diff-view pending-diff-view dock-scroll">
              {visiblePendingDiffLines.length ? (
                visiblePendingDiffLines.map((line, index) => (
                  <div
                    key={`${line.leftNumber ?? 'L'}-${line.rightNumber ?? 'R'}-${index}`}
                    className={`diff-line diff-${line.type}`}
                  >
                    <span className="diff-number">{line.leftNumber ?? ''}</span>
                    <span className="diff-number">{line.rightNumber ?? ''}</span>
                    <code>{line.text || ' '}</code>
                  </div>
                ))
              ) : (
                <div className="empty-state">No diff details available.</div>
              )}
              {pendingDiffLines.length > visiblePendingDiffLines.length ? (
                <div className="diff-truncation">
                  Showing the first {visiblePendingDiffLines.length} diff rows.
                </div>
              ) : null}
            </div>

            <div className="dock-subsection">
              <div className="section-head">
                <div>
                  <h2>Patch Chunks</h2>
                  <div className="muted-text">
                    Preview or stage individual diff chunks instead of the whole file.
                  </div>
                </div>
                <div className="section-actions">
                  <span className="badge">{pendingDiffChunks.length} chunks</span>
                  {selectedChunkIds.length ? (
                    <span className="badge">{selectedChunkIds.length} selected</span>
                  ) : null}
                  <button
                    className="ghost-button"
                    onClick={toggleAllPendingChunks}
                    disabled={!pendingDiffChunks.length}
                  >
                    {pendingDiffChunks.length &&
                    selectedChunkIds.length === pendingDiffChunks.length
                      ? 'Clear all'
                      : 'Select all'}
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => previewSelectedPendingChunks(selectedPendingChange)}
                    disabled={!selectedChunkIds.length}
                  >
                    Preview Selected
                  </button>
                  <button
                    className="primary-button"
                    onClick={() => void applySelectedPendingChunks(selectedPendingChange)}
                    disabled={!selectedChunkIds.length}
                  >
                    Apply Selected
                  </button>
                </div>
              </div>

              <div className="chunk-list">
                {pendingDiffChunks.length ? (
                  pendingDiffChunks.map(chunk => (
                    <article
                      key={chunk.id}
                      className={`chunk-card ${
                        selectedChunkIds.includes(chunk.id) ? 'chunk-card-selected' : ''
                      }`}
                    >
                      <div className="chunk-card-head">
                        <div>
                          <strong>{chunk.id}</strong>
                          <div className="muted-text">
                            +{chunk.additions} / -{chunk.removals}
                          </div>
                        </div>
                        <div className="chunk-card-actions">
                          <button
                            className={`ghost-button ${
                              selectedChunkIds.includes(chunk.id) ? 'chunk-toggle-active' : ''
                            }`}
                            onClick={() => togglePendingChunkSelection(chunk.id)}
                          >
                            {selectedChunkIds.includes(chunk.id) ? 'Selected' : 'Select'}
                          </button>
                          <button
                            className="ghost-button"
                            onClick={() => previewPendingChunk(selectedPendingChange, chunk)}
                          >
                            Preview
                          </button>
                          <button
                            className="primary-button"
                            onClick={() => void applyPendingChunk(selectedPendingChange, chunk)}
                          >
                            Apply Chunk
                          </button>
                        </div>
                      </div>

                      <div className="diff-view chunk-diff-view">
                        {chunk.lines.map((line, index) => (
                          <div
                            key={`${chunk.id}-${line.leftNumber ?? 'L'}-${line.rightNumber ?? 'R'}-${index}`}
                            className={`diff-line diff-${line.type}`}
                          >
                            <span className="diff-number">{line.leftNumber ?? ''}</span>
                            <span className="diff-number">{line.rightNumber ?? ''}</span>
                            <code>{line.text || ' '}</code>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">No patch chunks detected.</div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="pending-preview dock-subsection">
            <div className="empty-state">
              Pick a changed file to inspect its diff details here.
            </div>
          </div>
        )}
      </section>
    )
  }

  function renderGitPanel() {
    const diffSections = [
      gitDiff?.unstagedDiff
        ? {
            id: 'unstaged',
            label: 'Working Tree',
            content: gitDiff.unstagedDiff,
          }
        : null,
      gitDiff?.stagedDiff
        ? {
            id: 'staged',
            label: 'Staged',
            content: gitDiff.stagedDiff,
          }
        : null,
    ].filter(Boolean) as Array<{ id: string; label: string; content: string }>

    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Git</h2>
            <div className="muted-text">
              Branch {gitStatus?.branch || 'not detected'} / {gitStatus?.files.length ?? 0} changed
              file{(gitStatus?.files.length ?? 0) === 1 ? '' : 's'}
            </div>
          </div>
          <div className="quick-actions">
            <button className="ghost-button" onClick={() => void loadGitStatus(gitSelectedPath)}>
              Refresh
            </button>
            <button
              className="ghost-button"
              onClick={() => void stageGitFile()}
              disabled={!gitStatus?.isRepo || !gitStatus.files.length || gitBusy}
            >
              Stage all
            </button>
          </div>
        </div>

        {!gitStatus?.isRepo ? (
          <div className="empty-state">
            This workspace does not look like a Git repository yet. Open a repo root to unlock
            status, diff, stage, and commit actions here.
          </div>
        ) : (
          <>
            <div className="git-summary-row">
              <span className="badge">{gitStatus.branch || 'detached'}</span>
              <span className="badge">staged {gitStatus.stagedCount}</span>
              <span className="badge">unstaged {gitStatus.unstagedCount}</span>
              <span className="badge">untracked {gitStatus.untrackedCount}</span>
              {gitStatus.ahead ? <span className="badge">ahead {gitStatus.ahead}</span> : null}
              {gitStatus.behind ? <span className="badge">behind {gitStatus.behind}</span> : null}
            </div>

            <div className="git-commit-box">
              <label className="field">
                <span>Commit Message</span>
                <textarea
                  rows={2}
                  value={gitCommitMessage}
                  onChange={event => setGitCommitMessage(event.target.value)}
                  placeholder="feat: describe the change"
                />
              </label>
              <div className="quick-actions">
                <button
                  className="primary-button"
                  onClick={() => void commitGitChanges()}
                  disabled={gitBusy || !gitStatus.stagedCount}
                >
                  Commit staged
                </button>
              </div>
            </div>

            <div className="git-workspace">
              <div className="git-file-list dock-subsection">
                {gitStatus.files.length ? (
                  gitStatus.files.map(file => {
                    const isDirectoryLike = file.path.endsWith('/')

                    return (
                      <article
                        key={file.path}
                        className={`git-file-card ${
                          file.path === selectedGitFile?.path ? 'git-file-card-active' : ''
                        }`}
                      >
                        <button
                          className="git-file-main"
                          onClick={() => {
                            setGitSelectedPath(file.path)
                            void loadGitDiff(file.path)
                          }}
                        >
                          <div className="git-file-head">
                            <strong>{file.path}</strong>
                            <span className="muted-text">
                              {file.indexStatus}{file.workTreeStatus}
                            </span>
                          </div>
                          <div className="git-file-meta">
                            {file.renamedFrom ? <span>renamed from {file.renamedFrom}</span> : null}
                            {file.untracked ? <span>untracked</span> : null}
                            {file.staged ? <span>staged</span> : null}
                            {file.unstaged ? <span>unstaged</span> : null}
                            {isDirectoryLike ? <span>directory</span> : null}
                          </div>
                        </button>
                        <div className="git-file-actions">
                          {!isDirectoryLike ? (
                            <button
                              className="ghost-button subtle-button"
                              onClick={() => void openFile(file.path)}
                            >
                              Open
                            </button>
                          ) : null}
                          {!isDirectoryLike ? (
                            <button
                              className="ghost-button subtle-button"
                              onClick={() => void attachWorkspaceFileToPrompt(file.path)}
                            >
                              Attach
                            </button>
                          ) : null}
                          {file.staged ? (
                            <button
                              className="ghost-button subtle-button"
                              onClick={() => void unstageGitFile(file.path)}
                            >
                              Unstage
                            </button>
                          ) : (
                            <button
                              className="ghost-button subtle-button"
                              onClick={() => void stageGitFile(file.path)}
                            >
                              Stage
                            </button>
                          )}
                        </div>
                      </article>
                    )
                  })
                ) : (
                  <div className="empty-state">Working tree clean.</div>
                )}
              </div>

              <div className="git-diff-panel dock-subsection">
                {selectedGitFile ? (
                  <>
                    {selectedGitFile.path.endsWith('/') ? (
                      <div className="empty-state">
                        This changed item is a directory entry. You can stage it, but there is no
                        file-level diff to preview yet.
                      </div>
                    ) : null}
                    <div className="pending-preview-head">
                      <div>
                        <strong>{selectedGitFile.path}</strong>
                        <div className="muted-text">
                          {selectedGitFile.staged ? 'Has staged diff' : 'No staged diff'} /{' '}
                          {selectedGitFile.unstaged ? 'Has working tree diff' : 'No unstaged diff'}
                        </div>
                      </div>
                      <div className="quick-actions">
                        {!selectedGitFile.path.endsWith('/') ? (
                          <button
                            className="ghost-button subtle-button"
                            onClick={() => void openFile(selectedGitFile.path)}
                          >
                            Open file
                          </button>
                        ) : null}
                        {!selectedGitFile.path.endsWith('/') ? (
                          <button
                            className="ghost-button subtle-button"
                            onClick={() => void attachWorkspaceFileToPrompt(selectedGitFile.path)}
                          >
                            Attach to chat
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {selectedGitFile.path.endsWith('/') ? null : gitBusy && !diffSections.length ? (
                      <div className="empty-state">Loading git diff...</div>
                    ) : !selectedGitFile.path.endsWith('/') && diffSections.length ? (
                      <div className="git-diff-sections">
                        {diffSections.map(section => {
                          const highlightedLines = getHighlightedCodeLines(section.content, 'diff')
                          return (
                            <section key={section.id} className="message-code-block git-diff-block">
                              <div className="message-code-head">
                                <div className="message-code-meta">
                                  <span>{section.label}</span>
                                  <span className="code-meta-separator">/</span>
                                  <span>{highlightedLines.length} lines</span>
                                </div>
                              </div>
                              <div className="message-code-lines">
                                {highlightedLines.map((line, index) => (
                                  <div key={`${section.id}-${index}`} className="message-code-line">
                                    <span className="message-code-line-number">{index + 1}</span>
                                    <span
                                      className="message-code-line-content"
                                      dangerouslySetInnerHTML={{ __html: line || ' ' }}
                                    />
                                  </div>
                                ))}
                              </div>
                            </section>
                          )
                        })}
                      </div>
                    ) : !selectedGitFile.path.endsWith('/') ? (
                      <div className="empty-state">No diff output for this file.</div>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">Select a changed file to inspect its diff.</div>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    )
  }

  function renderTerminalPanel() {
    return (
      <section className="dock-card dock-card-fill">
        <div className="section-head">
          <div>
            <h2>Terminal</h2>
            <div className="terminal-cwd">cwd: {activeSession?.terminalCwd || '.'}</div>
          </div>
          <div className="quick-actions">
            <button className="ghost-button" onClick={() => void runTerminalCommand('npm test')}>
              npm test
            </button>
            <button
              className="ghost-button"
              onClick={() => void runTerminalCommand('git status --short')}
            >
              git status
            </button>
          </div>
        </div>

        <div className="field-grid">
          <label className="field">
            <span>Working Directory</span>
            <input
              value={activeSession?.terminalCwd ?? '.'}
              onChange={event =>
                updateActiveSession(session => ({
                  ...session,
                  terminalCwd: event.target.value,
                }))
              }
            />
          </label>
          <label className="field">
            <span>Command</span>
            <input
              value={activeSession?.terminalCommand ?? ''}
              onChange={event =>
                updateActiveSession(session => ({
                  ...session,
                  terminalCommand: event.target.value,
                }))
              }
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void runTerminalCommand()
                }
              }}
              placeholder="rg TODO src"
            />
          </label>
        </div>

        <div className="composer-footer">
          <div className="muted-text">Press Enter to run</div>
          <button
            className="primary-button"
            onClick={() => void runTerminalCommand()}
            disabled={terminalBusy}
          >
            Run Command
          </button>
        </div>

        <div className="terminal-history dock-scroll">
          {activeSession?.terminalHistory.length ? (
            activeSession.terminalHistory.map(entry => (
              <article
                key={entry.id}
                className={`terminal-entry terminal-${entry.status}`}
              >
                <div className="terminal-entry-head">
                  <strong>{entry.command}</strong>
                  <span className="muted-text">{formatTime(entry.createdAt)}</span>
                </div>
                <div className="muted-text">{entry.cwd}</div>
                <pre>{entry.output}</pre>
              </article>
            ))
          ) : (
            <div className="empty-state">No terminal output yet.</div>
          )}
        </div>
      </section>
    )
  }

  function renderSessionCard(session: SessionState) {
    const provider = settings?.providers.find(item => item.id === session.providerId) ?? null
    const isDragging = draggingSessionId === session.id
    const isRenaming = renamingSessionId === session.id
    const isConfirmingDelete = confirmDeleteSessionId === session.id
    const draggingSession = sessions.find(item => item.id === draggingSessionId) ?? null
    const canDropOn =
      Boolean(draggingSession) &&
      draggingSession?.id !== session.id &&
      draggingSession?.workspaceRoot === session.workspaceRoot &&
      getSessionGroupKey(draggingSession) === getSessionGroupKey(session)

    return (
      <div
        key={session.id}
        className={`session-list-item ${
          session.id === activeSession.id ? 'session-list-item-active' : ''
        } ${isDragging ? 'session-list-item-dragging' : ''} ${
          canDropOn && dropSessionId === session.id ? 'session-list-item-drop-target' : ''
        }`}
        draggable
        onDragStart={() => {
          setDraggingSessionId(session.id)
          setDropSessionId(session.id)
        }}
        onDragOver={event => {
          if (!canDropOn) {
            return
          }
          event.preventDefault()
          if (dropSessionId !== session.id) {
            setDropSessionId(session.id)
          }
        }}
        onDrop={event => {
          event.preventDefault()
          if (draggingSessionId && canDropOn) {
            moveWorkspaceSession(draggingSessionId, session.id)
          }
          setDraggingSessionId('')
          setDropSessionId('')
        }}
        onDragEnd={() => {
          setDraggingSessionId('')
          setDropSessionId('')
        }}
      >
        <button className="session-list-main" onClick={() => setActiveSessionId(session.id)}>
          <div className="session-list-top">
            {isRenaming ? (
              <input
                className="inline-rename-input"
                value={sessionRenameDraft}
                autoFocus
                onChange={event => setSessionRenameDraft(event.target.value)}
                onClick={event => event.stopPropagation()}
                onBlur={() => commitSessionRename(session.id)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitSessionRename(session.id)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    cancelSessionRename()
                  }
                }}
              />
            ) : (
              <strong>{session.title}</strong>
            )}
            <span>{provider?.name ?? (session.providerId || 'No provider')}</span>
          </div>
          <p>{getSessionPreview(session)}</p>
          <div className="session-list-meta">
            <span>{session.model || 'No model'}</span>
            <span>{session.messages.length} msgs</span>
          </div>
          {session.tags?.length ? (
            <div className="session-tag-row">
              {session.tags.map(tag => (
                <span key={`${session.id}-${tag}`} className="session-tag">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </button>
        <div className="session-list-actions">
          <span className="session-list-grip" title="Drag to reorder">
            Drag
          </span>
          {!session.archived ? (
            <button
              className={`session-list-icon ${session.pinned ? 'session-list-icon-active' : ''}`}
              onClick={() => toggleSessionPinned(session.id)}
              title={session.pinned ? 'Unpin chat' : 'Pin chat'}
            >
              {session.pinned ? 'Pinned' : 'Pin'}
            </button>
          ) : null}
          <button
            className="session-list-icon"
            onClick={() => toggleSessionArchived(session.id)}
            title={session.archived ? 'Restore chat' : 'Archive chat'}
          >
            {session.archived ? 'Restore' : 'Archive'}
          </button>
          <button
            className={`session-list-icon ${isRenaming ? 'session-list-icon-active' : ''}`}
            onClick={() =>
              isRenaming ? commitSessionRename(session.id) : startSessionRename(session.id)
            }
            title={isRenaming ? 'Save rename' : 'Rename chat'}
          >
            {isRenaming ? 'Save' : 'Rename'}
          </button>
          <button
            className="session-list-close"
            onClick={() => requestDeleteSession(session.id)}
            title="Delete chat"
          >
            {isConfirmingDelete ? 'Confirm' : 'Delete'}
          </button>
        </div>
      </div>
    )
  }

  function renderProjectRailItem(project: (typeof filteredSidebarProjects)[number]) {
    const active = project.root === settings?.workspaceRoot
    const isFavorite = workspacePresets.some(
      preset => preset.root === project.root && Boolean(preset.favorite),
    )
    const projectSessions = (sidebarProjectSessions.get(project.root) ?? []).slice(0, 5)
    const expanded = active || projectFilter.trim().length > 0 || expandedProjectRoots.includes(project.root)

    return (
      <div
        key={project.root}
        className={`project-rail-item ${active ? 'project-rail-item-active' : ''}`}
      >
        <div className="project-rail-row">
          <button
            className="project-rail-main"
            onClick={() =>
              active ? openWorkspaceTab('projects') : void switchWorkspacePreset(project.root)
            }
          >
            <div className="project-rail-head">
              <strong>{project.name}</strong>
              {active ? <span className="badge">Open</span> : null}
            </div>
            <div className="project-rail-path">{project.root}</div>
            <div className="project-rail-meta">
              <span>{project.chatCount} chats</span>
              <span>{project.saved ? 'saved' : 'current only'}</span>
            </div>
          </button>

          <div className="project-rail-actions">
            <button
              className="project-rail-icon"
              onClick={() => void createSessionForProject(project.root)}
              title="Create a new chat in this project"
            >
              New
            </button>
            {projectSessions.length ? (
              <button
                className="project-rail-icon"
                onClick={() => toggleProjectRailExpansion(project.root)}
                title={expanded ? 'Collapse chats' : 'Expand chats'}
              >
                {expanded ? 'Hide' : 'Chats'}
              </button>
            ) : null}
            <button
              className={`project-rail-icon ${
                isFavorite ? 'project-rail-icon-active' : ''
              }`}
              onClick={() => toggleWorkspacePresetFavorite(project.root, project.name)}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              {isFavorite ? 'Favorite' : 'Star'}
            </button>
          </div>
        </div>

        {expanded && projectSessions.length ? (
          <div className="project-rail-children">
            {projectSessions.map(session => {
              const isRenaming = renamingSessionId === session.id
              const isConfirmingDelete = confirmDeleteSessionId === session.id

              return (
                <div
                  key={session.id}
                  className={`project-rail-session-card ${
                    session.id === activeSessionId ? 'project-rail-session-card-active' : ''
                  }`}
                >
                  <button
                    className={`project-rail-session ${
                      session.id === activeSessionId ? 'project-rail-session-active' : ''
                    }`}
                    onClick={() =>
                      active
                        ? setActiveSessionId(session.id)
                        : void switchWorkspacePreset(project.root, session.id)
                    }
                  >
                    <div className="project-rail-session-head">
                      {isRenaming ? (
                        <input
                          className="inline-rename-input"
                          value={sessionRenameDraft}
                          autoFocus
                          onChange={event => setSessionRenameDraft(event.target.value)}
                          onClick={event => event.stopPropagation()}
                          onBlur={() => commitSessionRename(session.id)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') {
                              event.preventDefault()
                              commitSessionRename(session.id)
                            }
                            if (event.key === 'Escape') {
                              event.preventDefault()
                              cancelSessionRename()
                            }
                          }}
                        />
                      ) : (
                        <strong>{session.title}</strong>
                      )}
                      {session.pinned ? <span className="badge">Pinned</span> : null}
                    </div>
                    <span>{getSessionPreview(session)}</span>
                  </button>
                  <div className="project-rail-session-actions">
                    <button
                      className={`project-rail-session-icon ${
                        session.pinned ? 'project-rail-session-icon-active' : ''
                      }`}
                      onClick={() => toggleSessionPinned(session.id)}
                      title={session.pinned ? 'Unpin chat' : 'Pin chat'}
                    >
                      {session.pinned ? 'Pinned' : 'Pin'}
                    </button>
                    <button
                      className={`project-rail-session-icon ${
                        isRenaming ? 'project-rail-session-icon-active' : ''
                      }`}
                      onClick={() =>
                        isRenaming ? commitSessionRename(session.id) : startSessionRename(session.id)
                      }
                      title={isRenaming ? 'Save rename' : 'Rename chat'}
                    >
                      {isRenaming ? 'Save' : 'Rename'}
                    </button>
                    <button
                      className="project-rail-session-icon"
                      onClick={() => toggleSessionArchived(session.id)}
                      title="Archive chat"
                    >
                      Archive
                    </button>
                    <button
                      className="project-rail-session-icon project-rail-session-delete"
                      onClick={() => requestDeleteSession(session.id)}
                      title="Delete chat"
                    >
                      {isConfirmingDelete ? 'Confirm' : 'Delete'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  function renderWorkspaceContent() {
    switch (workspaceTab) {
      case 'projects':
        return renderProjectsPanel()
      case 'git':
        return renderGitPanel()
      case 'files':
        return renderFilesPanel()
      case 'editor':
        return renderEditorPanel()
      case 'changes':
        return renderChangesPanel()
      case 'terminal':
        return renderTerminalPanel()
      case 'providers':
        return renderProvidersPanel()
      case 'settings':
        return renderSettingsPanel()
      default:
        return renderFilesPanel()
    }
  }

  if (!settings || !activeSession) {
    return (
      <div className="shell">
        <div className="brand-card">
          <div className="eyebrow">RoyCode Studio</div>
          <h1>Loading Workspace</h1>
          <p>{status}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={shellClassName} style={shellStyle}>
      <input
        ref={importInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        onChange={event => void importSessionsArchive(event)}
      />
      <input
        ref={attachmentInputRef}
        className="visually-hidden"
        type="file"
        accept="image/*,.txt,.md,.json,.js,.ts,.tsx,.jsx,.css,.html,.yml,.yaml,.xml,.py,.java,.go,.rs,.sql,.sh,.ps1,.c,.cpp,.h,.hpp"
        multiple
        onChange={event => void importPromptAttachments(event)}
      />
      <aside className="sidebar app-sidebar">
        <div className="sidebar-header sidebar-header-compact">
          <div className="sidebar-brand-row">
            <div>
              <div className="eyebrow">RoyCode Studio</div>
              <h1>{settings.appName}</h1>
            </div>
            <span
              className={`sidebar-status-dot ${busy ? 'sidebar-status-dot-busy' : ''}`}
              title={busy ? 'Assistant busy' : 'Assistant ready'}
            />
          </div>
          <div className="sidebar-toolbar">
            <button className="primary-button" onClick={createSessionTab}>
              New Thread
            </button>
            <button className="ghost-button" onClick={openCommandPalette} title="Ctrl+K">
              Search
            </button>
          </div>
        </div>

        <div className="sidebar-summary sidebar-summary-card">
          <div className="sidebar-summary-head">
            <div>
              <div className="eyebrow">Current Workspace</div>
              <strong>{getWorkspaceLabel(settings.workspaceRoot)}</strong>
            </div>
            <button className="badge badge-button" onClick={() => openWorkspaceTab('projects')}>
              Open
            </button>
          </div>
          <div className="sidebar-summary-path">{settings.workspaceRoot}</div>
          <div className="sidebar-summary-metrics">
            <span className="badge">{settings.accessMode === 'unrestricted' ? 'Full access' : 'Workspace only'}</span>
            <span className="badge">{workspaceSessions.length} threads</span>
            <span className="badge">{pendingChanges.length} pending</span>
            <span className="badge">{settings.providers.length} models</span>
          </div>
        </div>

        <div className="project-rail">
          <div className="section-head">
            <div>
              <h2>Workspaces</h2>
              <div className="muted-text">Switch local roots and keep project context close.</div>
            </div>
            <button className="ghost-button subtle-button" onClick={() => openWorkspaceTab('projects')}>
              Manage
            </button>
          </div>

          <label className="field project-rail-search">
            <span>Search Projects</span>
            <input
              value={projectFilter}
              onChange={event => setProjectFilter(event.target.value)}
              placeholder="Find a project"
            />
          </label>

          <div className="project-rail-filters">
            {(
              [
                ['all', `All (${filteredSidebarProjects.length})`],
                ['favorites', `Favorites (${favoriteSidebarProjects.length})`],
                ['recent', `Recent (${recentSidebarProjects.length})`],
              ] as const
            ).map(([viewId, label]) => (
              <button
                key={viewId}
                className={`filter-chip ${
                  projectRailView === viewId ? 'filter-chip-active' : ''
                }`}
                onClick={() => setProjectRailView(viewId)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="project-rail-list">
            {visibleFavoriteSidebarProjects.length ? (
              <div className="session-group">
                <div className="session-group-label">Favorites</div>
                {visibleFavoriteSidebarProjects.map(renderProjectRailItem)}
              </div>
            ) : null}

            {visibleRecentSidebarProjects.length ? (
              <div className="session-group">
                <div className="session-group-label">Recent Projects</div>
                {visibleRecentSidebarProjects.map(renderProjectRailItem)}
              </div>
            ) : null}

            {!visibleFavoriteSidebarProjects.length && !visibleRecentSidebarProjects.length ? (
              <div className="empty-state">No projects match this search.</div>
            ) : null}
          </div>
        </div>

        <div className="sidebar-section-head">
          <div>
            <h2>Threads</h2>
            <div className="muted-text">Recent conversations for this workspace.</div>
          </div>
          <span className="badge">{workspaceSessions.length}</span>
        </div>

        <label className="field sidebar-search">
          <span>Search Threads</span>
          <input
            value={sessionFilter}
            onChange={event => setSessionFilter(event.target.value)}
            placeholder="Find a thread or tag"
          />
        </label>

        <div className="sidebar-utility-row">
          <button
            className="ghost-button subtle-button"
            onClick={() => setShowArchivedSessions(current => !current)}
          >
            {showArchivedSessions ? 'Hide archived' : 'Show archived'}
          </button>
          <span className="muted-text">{archivedSessions.length} archived</span>
        </div>

        <div className="session-history">
          {filteredSessions.length ? (
            <>
              {pinnedSessions.length ? (
                <div className="session-group">
                  <div className="session-group-label">Pinned</div>
                  {pinnedSessions.map(renderSessionCard)}
                </div>
              ) : null}

              {regularSessions.length ? (
                <div className="session-group">
                  <div className="session-group-label">Recent</div>
                  {regularSessions.map(renderSessionCard)}
                </div>
              ) : null}

              {archivedSessions.length ? (
                <div className="session-group">
                  <div className="session-group-label">
                    Archived ({archivedSessions.length})
                  </div>
                  {showArchivedSessions
                    ? archivedSessions.map(renderSessionCard)
                    : null}
                </div>
              ) : null}
            </>
          ) : (
            <div className="empty-state">No chats match this search.</div>
          )}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-utility-row">
            <button className="ghost-button subtle-button" onClick={toggleTheme}>
              {theme === 'light' ? 'Dark mode' : 'Light mode'}
            </button>
            <button
              className="ghost-button subtle-button"
              onClick={toggleSidebarVisibility}
              title="Ctrl+B"
            >
              {sidebarCollapsed ? 'Show chats' : 'Hide chats'}
            </button>
            <button className="ghost-button subtle-button" onClick={exportSessionsArchive}>
              Export
            </button>
            <button className="ghost-button subtle-button" onClick={triggerImportArchive}>
              Import
            </button>
          </div>
          <div className="muted-text">
            Safe write {settings.safeWriteMode ? 'on' : 'off'} / {settings.accessMode}
          </div>
          <div className="muted-text">{status}</div>
        </div>
      </aside>

      <main className="main-layout llm-main">
        <header className="topbar topbar-codex">
          <div className="topbar-main">
            <div className="eyebrow">Thread</div>
            <div className="topbar-title-row">
              <input
                className="title-input"
                value={activeSession.title}
                onChange={event =>
                  updateActiveSession(session => ({
                    ...session,
                    title: event.target.value,
                  }))
                }
              />
              <span className="status-pill topbar-status">
                {busy ? 'Working...' : status}
              </span>
            </div>
            <div className="topbar-meta-row topbar-meta-row-codex">
              <label className="inline-tag-field topbar-tag-field">
                <span>Tags</span>
                <input
                  value={sessionTagDraft}
                  onChange={event => setSessionTagDraft(event.target.value)}
                  onBlur={() => commitActiveSessionTags()}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      commitActiveSessionTags(sessionTagDraft)
                    }
                  }}
                  placeholder="frontend, urgent, refactor"
                />
              </label>
              <div className="topbar-session-badges">
                <span className="badge">{getWorkspaceLabel(activeSession.workspaceRoot)}</span>
                <span className="badge">{currentProviderName}</span>
                <span className="badge">{activeSession.model || 'Choose a model'}</span>
                {activeSession.pinned ? <span className="badge">Pinned</span> : null}
                {activeSession.archived ? <span className="badge">Archived</span> : null}
              </div>
            </div>
          </div>

          <div className="topbar-controls topbar-controls-codex">
            <div className="topbar-utility-actions">
              <button className="ghost-button" onClick={openCommandPalette} title="Ctrl+K">
                Search
              </button>
              {isDesktopShell ? (
                <button className="ghost-button" onClick={() => void pickDesktopWorkspaceFolder()}>
                  Open Folder
                </button>
              ) : null}
              <button
                className="ghost-button"
                onClick={() => {
                  openWorkspaceTab('git')
                  void loadGitStatus(gitSelectedPath)
                }}
                title="Ctrl+Shift+G"
              >
                Git
              </button>
              <button className="ghost-button" onClick={toggleSidebarVisibility} title="Ctrl+B">
                {sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
              </button>
              <button
                className="ghost-button"
                onClick={toggleWorkspaceDock}
                title="Ctrl+Shift+D"
              >
                {dockCollapsed ? 'Show Workspace' : 'Hide Workspace'}
              </button>
              <button className="ghost-button" onClick={toggleTheme}>
                {theme === 'light' ? 'Dark' : 'Light'}
              </button>
              <button className="ghost-button" onClick={() => openWorkspaceTab('changes')}>
                Reviews {pendingChanges.length ? `(${pendingChanges.length})` : ''}
              </button>
            </div>

            <label className="compact-field">
              <span>Provider</span>
              <select
                value={activeSession.providerId}
                onChange={event => {
                  const nextProvider =
                    settings.providers.find(item => item.id === event.target.value) ??
                    settings.providers[0]
                  updateActiveSession(session => ({
                    ...session,
                    providerId: nextProvider?.id ?? '',
                    model:
                      nextProvider?.models.includes(session.model)
                        ? session.model
                        : nextProvider?.defaultModel ?? nextProvider?.models[0] ?? '',
                  }))
                }}
              >
                {settings.providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="compact-field">
              <span>Model</span>
              <select
                value={activeSession.model}
                onChange={event =>
                  updateActiveSession(session => ({
                    ...session,
                    model: event.target.value,
                  }))
                }
              >
                {(selectedProvider?.models ?? []).map(model => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </header>

        <div ref={workspaceFrameRef} className={workspaceFrameClassName}>
          <section className="chat-surface">
            <div className="chat-surface-header chat-surface-header-codex">
              <div className="conversation-summary">
                <div className="chat-heading">{currentProviderName}</div>
                <div className="muted-text visually-hidden">
                  {activeSession.model || 'Choose a model'} ·{' '}
                  {activeSession.selectedFile || 'No file selected'}
                </div>
                <div className="muted-text visually-hidden">
                  {[activeSession.model || 'Choose a model', activeSession.selectedFile || 'No file selected'].join(' · ')}
                </div>
                <div className="muted-text">
                  {activeSession.model || 'Choose a model'} /{' '}
                  {activeSession.selectedFile || 'No file selected'}
                </div>
                <div className="conversation-summary-line">
                  <span className="context-chip">{activeSession.model || 'Choose a model'}</span>
                  <span className="context-chip">
                    {activeSession.selectedFile || 'No file selected'}
                  </span>
                  <span className="context-chip">
                    {settings.safeWriteMode ? 'Safe write on' : 'Direct write'}
                  </span>
                  <span className="context-chip">
                    {settings.accessMode === 'unrestricted'
                      ? 'Full local access'
                      : 'Workspace sandbox'}
                  </span>
                </div>
              </div>
              <div className="chat-header-badges chat-header-badges-codex">
                {editorDirty ? <span className="badge">Editor dirty</span> : null}
                <span className="badge">{theme === 'light' ? 'Light' : 'Dark'}</span>
              </div>
            </div>

            {showPromptLanding ? (
              <div className="landing-panel">
                <div className="landing-copy">
                  <h2>What should we work on?</h2>
                  <p>
                    Ask RoyCode to inspect code, edit files, run commands, review diffs, and keep the workspace in sync.
                  </p>
                </div>
                <div className="suggestion-grid">
                  {PROMPT_SUGGESTIONS.map(suggestion => (
                    <button
                      key={suggestion}
                      className="suggestion-card"
                      onClick={() =>
                        updateActiveSession(session => ({
                          ...session,
                          prompt: suggestion,
                        }))
                      }
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div ref={chatScrollRef} className="messages chat-scroll">
                {activeSession.messages.map(message => {
                  const segments = parseMessageContent(message.content)

                  return (
                    <article
                      key={message.id}
                      className={`chat-message chat-message-${message.role}`}
                    >
                      <div className="chat-message-head">
                        <div className="chat-author">
                          {message.role === 'assistant' ? 'Assistant' : 'You'}
                        </div>
                        <div className="chat-message-actions">
                          {message.pending ? (
                            <span className="inline-status">streaming</span>
                          ) : null}
                          {message.content ? (
                            <button
                              className="ghost-button subtle-button"
                              onClick={() => void copyMessageContent(message.id, message.content)}
                            >
                              {copiedItemId === message.id ? 'Copied' : 'Copy'}
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="chat-message-body">
                        {message.attachments?.length ? (
                          <div className="message-attachments">
                            {message.attachments.map(attachment => (
                              <details key={attachment.id} className="message-attachment-card">
                                <summary>
                                  <span>{attachment.name}</span>
                                  <span className="muted-text">
                                    {attachment.kind === 'workspace-file'
                                      ? attachment.path || 'workspace file'
                                      : attachment.kind === 'image'
                                        ? attachment.mimeType || 'image'
                                        : attachment.mimeType || 'local file'}
                                  </span>
                                </summary>
                                {attachment.kind === 'image' && attachment.imageUrl ? (
                                  <div className="message-attachment-media">
                                    <img src={attachment.imageUrl} alt={attachment.name} />
                                  </div>
                                ) : null}
                                {attachment.content ? <pre>{attachment.content}</pre> : null}
                              </details>
                            ))}
                          </div>
                        ) : null}
                        {segments.length ? (
                          segments.map((segment, index) => {
                            if (segment.type === 'text') {
                              return (
                                <div
                                  key={`${message.id}-text-${index}`}
                                  className="message-markdown"
                                >
                                  {renderMarkdownSegment(
                                    segment.content,
                                    `${message.id}-text-${index}`,
                                  )}
                                </div>
                              )
                            }

                            const highlightedLines = getHighlightedCodeLines(
                              segment.code,
                              segment.language,
                            )
                            const lineCount = segment.code.split(/\r?\n/).length

                            return (
                              <section
                                key={`${message.id}-code-${index}`}
                                className="message-code-block"
                              >
                                <div className="message-code-head">
                                  <div className="message-code-meta">
                                    <span>{segment.language || 'code'}</span>
                                    <span className="code-meta-separator">/</span>
                                    <span>{lineCount} lines</span>
                                  </div>
                                  <div className="message-code-actions">
                                    <button
                                      className="ghost-button subtle-button"
                                      onClick={() =>
                                        void copyCodeBlock(message.id, index, segment.code)
                                      }
                                    >
                                      {copiedItemId === `${message.id}-code-${index}`
                                        ? 'Copied'
                                        : 'Copy code'}
                                    </button>
                                    {activeSession?.selectedFile ? (
                                      <button
                                        className="ghost-button subtle-button"
                                        onClick={() =>
                                          previewCodeBlockPatch(
                                            segment.code,
                                            `${segment.language || 'code'} block`,
                                          )
                                        }
                                      >
                                        Preview patch
                                      </button>
                                    ) : null}
                                    {activeSession?.selectedFile ? (
                                      <button
                                        className="ghost-button subtle-button"
                                        onClick={() =>
                                          void stageCodeBlockToCurrentFile(segment.code)
                                        }
                                      >
                                        {settings.safeWriteMode ? 'Stage patch' : 'Write file'}
                                      </button>
                                    ) : null}
                                    {activeSession?.selectedFile ? (
                                      <button
                                        className="ghost-button subtle-button"
                                        onClick={() => applyCodeBlockToCurrentFile(segment.code)}
                                      >
                                        Replace file
                                      </button>
                                    ) : null}
                                    <button
                                      className="ghost-button subtle-button"
                                      onClick={() => applyCodeBlockToEditor(segment.code)}
                                    >
                                      Use in editor
                                    </button>
                                  </div>
                                </div>
                                <div className="message-code-lines">
                                  {highlightedLines.map((line, lineIndex) => (
                                    <div
                                      key={`${message.id}-code-${index}-line-${lineIndex}`}
                                      className="message-code-line"
                                    >
                                      <span className="message-code-line-number">
                                        {lineIndex + 1}
                                      </span>
                                      <span
                                        className="message-code-line-content"
                                        dangerouslySetInnerHTML={{ __html: line || ' ' }}
                                      />
                                    </div>
                                  ))}
                                </div>
                              </section>
                            )
                          })
                        ) : message.attachments?.length ? null : (
                          <p className="message-paragraph">
                            {message.pending ? 'Thinking...' : '(empty)'}
                          </p>
                        )}
                      </div>
                      {message.toolEvents?.length ? (
                        <div className="tool-log">
                          {message.toolEvents.map((toolEvent, index) => (
                            <details key={`${message.id}-${toolEvent.name}-${index}`}>
                              <summary>{toolEvent.name}</summary>
                              <pre>{toolEvent.input}</pre>
                              <pre>{toolEvent.output}</pre>
                            </details>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            )}

            <div
              className={`composer composer-modern ${
                composerDragActive ? 'composer-drop-active' : ''
              }`}
              onDragEnter={handleComposerDragEnter}
              onDragOver={handleComposerDragOver}
              onDragLeave={handleComposerDragLeave}
              onDrop={event => void handleComposerDrop(event)}
            >
              {composerDragActive ? (
                <div className="composer-drop-overlay">
                  Drop text files or images here to attach them to this prompt.
                </div>
              ) : null}
              {showPromptLanding ? (
                <div className="composer-chips">
                  {PROMPT_SUGGESTIONS.slice(0, 3).map(suggestion => (
                    <button
                      key={suggestion}
                      className="prompt-chip"
                      onClick={() =>
                        updateActiveSession(session => ({
                          ...session,
                          prompt: suggestion,
                        }))
                      }
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              ) : null}

              {visibleSlashCommands.length ? (
                <div className="slash-command-list">
                  {visibleSlashCommands.map(command => (
                    <button
                      key={command.id}
                      className="slash-command-card"
                      onClick={() => void applySlashCommand(command.id)}
                    >
                      <strong>{command.label}</strong>
                      <span>{command.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}

              <div className="composer-toolbar">
                <button className="ghost-button subtle-button" onClick={attachCurrentWorkspaceFile}>
                  Attach File
                </button>
                <button className="ghost-button subtle-button" onClick={triggerAttachmentUpload}>
                  Upload
                </button>
                <span className="muted-text">
                  Drag files in or paste screenshots into the composer
                </span>
                {activeSession.promptAttachments?.length ? (
                  <button
                    className="ghost-button subtle-button"
                    onClick={() =>
                      updateActiveSession(session => ({
                        ...session,
                        promptAttachments: [],
                      }))
                    }
                  >
                    Clear attachments
                  </button>
                ) : null}
              </div>

              {activeSession.promptAttachments?.length ? (
                <div className="composer-attachments">
                  {activeSession.promptAttachments.map(attachment => (
                    <div key={attachment.id} className="composer-attachment-chip">
                      {attachment.kind === 'image' && attachment.imageUrl ? (
                        <div className="composer-attachment-thumb">
                          <img src={attachment.imageUrl} alt={attachment.name} />
                        </div>
                      ) : null}
                      <div className="composer-attachment-copy">
                        <strong>{attachment.name}</strong>
                        <span>
                          {attachment.path ||
                            attachment.mimeType ||
                            (attachment.kind === 'image' ? 'image' : attachment.kind)}
                          {attachment.truncated ? ' / trimmed' : ''}
                        </span>
                      </div>
                      <button
                        className="ghost-button subtle-button"
                        onClick={() => removePromptAttachment(attachment.id)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <textarea
                className="composer-input"
                rows={4}
                value={activeSession.prompt}
                onChange={event =>
                  updateActiveSession(session => ({
                    ...session,
                    prompt: event.target.value,
                  }))
                }
                onKeyDown={event => {
                  if (event.key === 'Tab' && visibleSlashCommands.length) {
                    event.preventDefault()
                    void applySlashCommand(visibleSlashCommands[0]!.id)
                    return
                  }
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault()
                    void sendPrompt()
                  }
                }}
                onPaste={event => void handleComposerPaste(event)}
                placeholder="Message RoyCode Studio to chat, write code, inspect files, or run tools..."
              />

              <div className="composer-footer composer-footer-modern">
                <div className="composer-meta">
                  <span>{activeSession.selectedFile || 'No file selected'}</span>
                  <span>{activeSession.promptAttachments?.length ?? 0} attachments</span>
                  <span>{visibleSlashCommands.length ? 'Tab to apply slash command' : 'Type / for tasks'}</span>
                  <span>Ctrl/Cmd + Enter to send</span>
                  <span>Ctrl/Cmd + K search</span>
                </div>
                <button
                  className="primary-button send-button"
                  onClick={() => void sendPrompt()}
                  disabled={busy}
                >
                  Send
                </button>
              </div>
            </div>
          </section>

          <div
            className={`workspace-resizer ${
              dockCollapsed ? 'workspace-resizer-hidden' : ''
            } ${dockResizing ? 'workspace-resizer-active' : ''}`}
            onMouseDown={startDockResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace dock"
          />

          <aside className={`workspace-dock ${dockCollapsed ? 'workspace-dock-collapsed' : ''}`}>
            <div className="workspace-dock-head">
              <div className="workspace-dock-title">
                <div className="eyebrow">Workspace</div>
                <strong>{activeWorkspaceTabLabel}</strong>
              </div>
              <button
                className="ghost-button subtle-button"
                onClick={toggleWorkspaceDock}
                title="Ctrl+Shift+D"
              >
                {dockCollapsed ? 'Show' : 'Hide'}
              </button>
            </div>
            <div className="dock-tabs">
              {WORKSPACE_TAB_ITEMS.map(tab => (
                <button
                  key={tab.id}
                  className={`dock-tab ${workspaceTab === tab.id ? 'dock-tab-active' : ''}`}
                  onClick={() => openWorkspaceTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="dock-body">{renderWorkspaceContent()}</div>
          </aside>
        </div>
      </main>

      {commandPaletteOpen ? (
        <div className="command-palette-backdrop" onClick={closeCommandPalette}>
          <div
            className="command-palette"
            onClick={event => event.stopPropagation()}
          >
            <div className="command-palette-head">
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                onChange={event => {
                  setCommandPaletteQuery(event.target.value)
                  setCommandPaletteIndex(0)
                }}
                onKeyDown={event => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeCommandPalette()
                    return
                  }

                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setCommandPaletteIndex(current =>
                      visibleCommandPaletteItems.length
                        ? (current + 1) % visibleCommandPaletteItems.length
                        : 0,
                    )
                    return
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setCommandPaletteIndex(current =>
                      visibleCommandPaletteItems.length
                        ? (current - 1 + visibleCommandPaletteItems.length) %
                          visibleCommandPaletteItems.length
                        : 0,
                    )
                    return
                  }

                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const selectedItem = visibleCommandPaletteItems[commandPaletteIndex]
                    if (selectedItem) {
                      void executeCommandPaletteItem(selectedItem)
                    }
                  }
                }}
                placeholder="Search projects, chats, tabs, and actions..."
              />
            </div>

            <div className="command-palette-list">
              {visibleCommandPaletteItems.length ? (
                visibleCommandPaletteItems.map((item, index) => (
                  <button
                    key={item.id}
                    className={`command-palette-item ${
                      index === commandPaletteIndex ? 'command-palette-item-active' : ''
                    }`}
                    onMouseEnter={() => setCommandPaletteIndex(index)}
                    onClick={() => void executeCommandPaletteItem(item)}
                  >
                    <span className="command-palette-section">{item.section}</span>
                    <div className="command-palette-copy">
                      <strong>{item.label}</strong>
                      <span>{item.hint}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state command-palette-empty">
                  No commands match this search.
                </div>
              )}
            </div>

            <div className="command-palette-footer">
              <span>Enter to open</span>
              <span>Up/Down to move</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
