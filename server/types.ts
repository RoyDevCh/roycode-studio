export type ProviderPresetId = 'deepseek' | 'minimax' | 'custom'

export type ProviderConfig = {
  id: string
  name: string
  preset: ProviderPresetId
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel?: string
  enabled: boolean
  notes?: string
}

export type ProviderPublic = Omit<ProviderConfig, 'apiKey'> & {
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

export type ExecutionMode = 'default' | 'plan' | 'worktree'

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export type TodoItem = {
  content: string
  status: TodoStatus
  note?: string
}

export type AppSettings = {
  appName: string
  workspaceRoot: string
  accessMode: AccessMode
  theme?: 'dark' | 'light' | 'auto'
  vimMode?: boolean
  briefMode?: boolean
  voiceMode?: boolean
  outputStyle?: string
  cleanupPeriodDays?: number
  defaultShell?: 'powershell' | 'bash'
  enableAllProjectMcpServers?: boolean
  selectedProviderId?: string
  selectedModel?: string
  systemPrompt: string
  commandTimeoutMs: number
  maxAgentSteps: number
  safeWriteMode: boolean
  providers: ProviderConfig[]
}

export type PublicSettings = Omit<AppSettings, 'providers'> & {
  providers: ProviderPublic[]
}

export type FileNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export type AgentContentPart =
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

export type AgentMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | AgentContentPart[]
}

export type AgentToolEvent = {
  name: string
  input: string
  output: string
}

export type StructuredQuestionOption = {
  label: string
  description?: string
}

export type StructuredQuestionPrompt = {
  header: string
  question: string
  options: StructuredQuestionOption[]
  multiSelect?: boolean
}

export type StructuredQuestionRequest = {
  questions: StructuredQuestionPrompt[]
}

export type StructuredQuestionResponse = {
  answers: Record<string, string>
}

export type ChatRequest = {
  providerId: string
  model: string
  sessionId?: string
  cwd?: string
  systemAddenda?: string[]
  allowedTools?: string[]
  disallowedTools?: string[]
  maxAgentSteps?: number
  messages: AgentMessage[]
}

export type ChatResponse = {
  model: string
  answer: string
  toolEvents: AgentToolEvent[]
}

export type PendingChangeSource = 'manual' | 'agent'

export type PendingChange = {
  path: string
  originalContent: string
  content: string
  updatedAt: string
  source: PendingChangeSource
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
      toolEvents: AgentToolEvent[]
    }
  | {
      type: 'error'
      error: string
    }
