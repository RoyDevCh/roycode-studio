export type ProviderPresetId = 'deepseek' | 'minimax' | 'custom'

export type ProviderPublic = {
  id: string
  name: string
  preset: ProviderPresetId
  baseUrl: string
  models: string[]
  defaultModel?: string
  enabled: boolean
  notes?: string
  hasApiKey: boolean
}

export type ProviderPreset = {
  id: ProviderPresetId
  name: string
  description: string
  baseUrl: string
  models: string[]
  docsUrl?: string
}

export type AccessMode = 'workspace' | 'unrestricted'

export type PublicSettings = {
  appName: string
  workspaceRoot: string
  accessMode: AccessMode
  selectedProviderId?: string
  selectedModel?: string
  systemPrompt: string
  commandTimeoutMs: number
  maxAgentSteps: number
  safeWriteMode: boolean
  providers: ProviderPublic[]
}

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export type ToolEvent = {
  name: string
  input: string
  output: string
}

export type RequestMessageContentPart =
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'image'
      imageUrl: string
      mimeType?: string
      detail?: 'auto' | 'low' | 'high'
    }

export type PromptAttachment = {
  id: string
  kind: 'workspace-file' | 'local-file' | 'image'
  name: string
  path?: string
  mimeType?: string
  content: string
  imageUrl?: string
  detail?: 'auto' | 'low' | 'high'
  truncated?: boolean
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: PromptAttachment[]
  pending?: boolean
  toolEvents?: ToolEvent[]
}

export type AgentStreamEvent =
  | {
      type: 'status'
      message: string
    }
  | {
      type: 'text-delta'
      delta: string
    }
  | {
      type: 'tool-start'
      name: string
      input: string
    }
  | {
      type: 'tool-result'
      name: string
      output: string
    }
  | {
      type: 'final'
      model: string
      answer: string
      toolEvents: ToolEvent[]
    }
  | {
      type: 'error'
      error: string
    }

export type DiffLine = {
  type: 'context' | 'add' | 'remove'
  leftNumber?: number
  rightNumber?: number
  text: string
}

export type TerminalEntry = {
  id: string
  command: string
  cwd: string
  output: string
  createdAt: string
  status: 'success' | 'error'
}

export type PendingChange = {
  path: string
  originalContent: string
  content: string
  updatedAt: string
  source: 'manual' | 'agent'
}

export type WorkspaceFilePayload = {
  path: string
  diskContent: string
  content: string
  pendingChange: PendingChange | null
}

export type GitChangedFile = {
  path: string
  indexStatus: string
  workTreeStatus: string
  staged: boolean
  unstaged: boolean
  untracked: boolean
  renamedFrom?: string
}

export type GitStatusPayload = {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  files: GitChangedFile[]
}

export type GitDiffPayload = {
  path: string
  unstagedDiff: string
  stagedDiff: string
}

export type DraftPatchPreview = {
  path: string
  content: string
  sourceLabel: string
  createdAt: string
}

export type SessionState = {
  id: string
  title: string
  workspaceRoot: string
  pinned?: boolean
  archived?: boolean
  tags?: string[]
  providerId: string
  model: string
  prompt: string
  promptAttachments?: PromptAttachment[]
  messages: ChatMessage[]
  draftPatch?: DraftPatchPreview | null
  selectedFile: string
  fileContent: string
  loadedFileContent: string
  diskFileContent: string
  terminalCommand: string
  terminalCwd: string
  terminalHistory: TerminalEntry[]
}
