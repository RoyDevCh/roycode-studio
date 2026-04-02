import React, {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import Static from '../node_modules/ink/build/components/Static.js'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readSettings } from './store.js'
import {
  applyStartupOptions,
  buildPromptLabel,
  createFreshState,
  getCliStatusSnapshot,
  parseCliArgs,
  printBanner,
  processInputLine,
  resolveStructuredQuestionAnswer,
  saveCurrentSession,
  setCliOutputTarget,
  setCliStructuredQuestionHandler,
  shutdownCliRuntime,
  startCliBackgroundServices,
  type CliState,
  type CliStatusSnapshot,
} from './cli.js'
import type {
  StructuredQuestionPrompt,
  StructuredQuestionRequest,
  StructuredQuestionResponse,
} from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const BUILT_CLI = path.join(APP_ROOT, 'dist-server', 'cli.js')
const SOURCE_CLI = path.join(APP_ROOT, 'server', 'cli.ts')
const TSX_CLI = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

type LogEntry = {
  id: string
  channel: 'stdout' | 'stderr' | 'system'
  text: string
}

type ShortcutItem = {
  keyLabel: string
  action: string
}

type StructuredQuestionSession = {
  request: StructuredQuestionRequest
  index: number
  answers: Record<string, string>
  resolve: (response: StructuredQuestionResponse) => void
  reject: (error: Error) => void
}

function createCliLaunch(): { command: string; args: string[] } {
  if (existsSync(BUILT_CLI)) {
    return {
      command: process.execPath,
      args: [BUILT_CLI],
    }
  }

  if (existsSync(TSX_CLI)) {
    return {
      command: process.execPath,
      args: [TSX_CLI, SOURCE_CLI],
    }
  }

  throw new Error('RoyCode CLI is not built yet. Run "npm install" and "npm run build" first.')
}

function shouldExitDirect(argv: string[]): boolean {
  const directFlags = new Set([
    '--help',
    '-h',
    '--prompt',
    '--print',
    '-p',
    '--web-search',
    '--web-fetch',
    '--list-sessions',
    '--plain',
    '--no-tui',
  ])
  return argv.some(flag => directFlags.has(flag))
}

function appendChunk(
  buffer: string,
  chunk: string,
): {
  nextBuffer: string
  lines: string[]
} {
  const combined = buffer + chunk.replace(/\r\n/g, '\n')
  const parts = combined.split('\n')
  const nextBuffer = parts.pop() ?? ''
  return {
    nextBuffer,
    lines: parts,
  }
}

function keepTail<T>(items: T[], max = 500): T[] {
  return items.length > max ? items.slice(items.length - max) : items
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-9;]*m/g, '')
}

function formatChannelColor(channel: LogEntry['channel']): string {
  switch (channel) {
    case 'stderr':
      return 'red'
    case 'system':
      return 'cyan'
    default:
      return 'white'
  }
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

const TuiHeader = memo(function TuiHeader(props: {
  status: string
  mode: string
  prompt: string
  compactStatusline: string
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        RoyCode TUI
      </Text>
      <Text color="gray">status: {props.status}</Text>
      <Text color="gray">mode: {props.mode}</Text>
      <Text color="gray">prompt: {props.prompt}</Text>
      <Text color="gray">{props.compactStatusline}</Text>
    </Box>
  )
})

const WorkspacePanel = memo(function WorkspacePanel(props: {
  snapshot: CliStatusSnapshot
}): React.ReactElement {
  const snapshot = props.snapshot
  return (
    <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
      <Text bold color="magenta">
        Workspace
      </Text>
      <Text color="gray">session: {snapshot.session}</Text>
      <Text color="gray">messages: {snapshot.messages}</Text>
      <Text color="gray">attachments: {snapshot.attachments}</Text>
      <Text color="gray">workspace: {snapshot.workspace}</Text>
      <Text color="gray">extra dirs: {snapshot.dirs}</Text>
      <Text color="gray">cwd: {snapshot.cwd}</Text>
      <Text color="gray">provider: {snapshot.provider}</Text>
      <Text color="gray">model: {snapshot.model}</Text>
      <Text color="gray">access: {snapshot.access}</Text>
      <Text color="gray">env: {snapshot.env}</Text>
      <Text color="gray">policy: {snapshot.policy}</Text>
      <Text color="gray">privacy: {snapshot.privacy}</Text>
      <Text color="gray">diagnostics: {snapshot.diagnostics}</Text>
      <Text color="gray">trace: {snapshot.trace}</Text>
      <Text color="gray">effort: {snapshot.effort}</Text>
      <Text color="gray">theme: {snapshot.theme}</Text>
      <Text color="gray">vim: {snapshot.vim}</Text>
      <Text color="gray">brief: {snapshot.brief}</Text>
      <Text color="gray">voice: {snapshot.voice}</Text>
      <Text color="gray">suggest: {snapshot.suggest}</Text>
      <Text color="gray">notify: {snapshot.notify}</Text>
      <Text color="gray">advisor: {snapshot.advisor}</Text>
      <Text color="gray">sleep-guard: {snapshot.sleepGuard}</Text>
      <Text color="gray">safe-write: {snapshot.safeWrite}</Text>
      <Text color="gray">flags: {snapshot.flags}</Text>
      <Text color="gray">passes: {snapshot.passes}</Text>
      <Text color="gray">style: {snapshot.style}</Text>
      <Text color="gray">skills: {snapshot.skills}</Text>
      <Text color="gray">summaries: {snapshot.summaries}</Text>
    </Box>
  )
})

const ShortcutsPanel = memo(function ShortcutsPanel(props: {
  shortcuts: ShortcutItem[]
  lastShortcut: string
}): React.ReactElement {
  return (
    <Box marginTop={1} borderStyle="round" borderColor="blue" paddingX={1} flexDirection="column">
      <Text bold color="blue">
        Shortcuts
      </Text>
      {props.shortcuts.map(item => (
        <Text key={`${item.keyLabel}-${item.action}`} color="gray">
          {item.keyLabel}: {item.action}
        </Text>
      ))}
      <Text color="gray">last: {props.lastShortcut}</Text>
    </Box>
  )
})

const RecentInputPanel = memo(function RecentInputPanel(props: {
  entries: string[]
}): React.ReactElement {
  return (
    <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
      <Text bold color="yellow">
        Recent Input
      </Text>
      {props.entries.length ? (
        props.entries.map((entry, index) => (
          <Text key={`${index}-${entry}`} color="gray">
            {truncateText(entry, 30)}
          </Text>
        ))
      ) : (
        <Text color="gray">No commands yet</Text>
      )}
    </Box>
  )
})

const SessionOutputPanel = memo(function SessionOutputPanel(props: {
  lines: LogEntry[]
  tail: string
  tailChannel: LogEntry['channel']
  outputEpoch: number
}): React.ReactElement {
  return (
    <Box flexGrow={1} flexDirection="column">
      <Static key={`output-${props.outputEpoch}`} items={props.lines}>
        {(entry: LogEntry) => (
          <Text key={entry.id} color={formatChannelColor(entry.channel)}>
            {entry.text}
          </Text>
        )}
      </Static>
      {props.tail ? (
        <Text color={formatChannelColor(props.tailChannel)}>{props.tail}</Text>
      ) : null}
    </Box>
  )
})

const StructuredQuestionPanel = memo(function StructuredQuestionPanel(props: {
  question: StructuredQuestionPrompt
  index: number
  total: number
}): React.ReactElement {
  return (
    <Box marginTop={1} borderStyle="round" borderColor="red" paddingX={1} flexDirection="column">
      <Text bold color="red">
        Clarification {props.index + 1}/{props.total}
      </Text>
      <Text>{props.question.header}</Text>
      <Text>{props.question.question}</Text>
      {props.question.options.map((option, optionIndex) => (
        <Text key={`${option.label}-${optionIndex}`} color="gray">
          {optionIndex + 1}. {option.label}
          {option.description ? ` - ${option.description}` : ''}
        </Text>
      ))}
      <Text color="gray">
        {props.question.multiSelect
          ? 'Enter one or more option numbers or labels separated by commas.'
          : 'Enter an option number, label, or your own short answer.'}
      </Text>
    </Box>
  )
})

const PromptComposer = memo(function PromptComposer(props: {
  answerMode: boolean
  resetKey: string
  onSubmit: (value: string) => Promise<void>
}): React.ReactElement {
  const [localInput, setLocalInput] = useState('')

  useEffect(() => {
    setLocalInput('')
  }, [props.resetKey])

  useInput((value, key) => {
    if (key.ctrl || key.meta || key.tab || key.escape) {
      return
    }
    if (key.return) {
      void props.onSubmit(localInput)
      setLocalInput('')
      return
    }
    if (key.backspace || key.delete) {
      setLocalInput(current => current.slice(0, -1))
      return
    }
    if (value) {
      setLocalInput(current => current + value)
    }
  })

  const renderedInput = `${localInput}_`

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="yellow">{props.answerMode ? 'answer' : 'prompt'}</Text>
      <Text>{renderedInput}</Text>
    </Box>
  )
})

function RoyCodeTui(): React.ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'boot',
      channel: 'system',
      text: 'RoyCode TUI booting native runtime...',
    },
  ])
  const [status, setStatus] = useState('Initializing RoyCode runtime...')
  const [snapshot, setSnapshot] = useState<CliStatusSnapshot>({
    session: 'loading',
    messages: '0 user / 0 assistant',
    attachments: '0',
    workspace: process.cwd(),
    dirs: '0',
    access: 'workspace',
    env: '0',
    policy: 'balanced',
    privacy: 'standard',
    diagnostics: 'on',
    trace: 'off',
    effort: 'auto',
    theme: 'dark',
    vim: 'off',
    brief: 'off',
    voice: 'off',
    suggest: 'on',
    notify: 'off',
    advisor: 'off',
    sleepGuard: 'off',
    safeWrite: 'on',
    flags: '0',
    passes: '0',
    style: 'default',
    provider: 'loading',
    model: 'loading',
    cwd: '.',
    mode: 'interactive tui',
    skills: 'none',
    summaries: '0',
  })
  const [history, setHistory] = useState<string[]>([])
  const [lastShortcut, setLastShortcut] = useState('none')
  const [promptLabel, setPromptLabel] = useState('roycode >')
  const [showInspector, setShowInspector] = useState(false)
  const [outputEpoch, setOutputEpoch] = useState(0)
  const [questionSession, setQuestionSession] = useState<StructuredQuestionSession | null>(null)
  const stateRef = useRef<CliState | null>(null)
  const stdoutBufferRef = useRef('')
  const logIdRef = useRef(1)
  const pendingLogsRef = useRef<Array<{ channel: LogEntry['channel']; text: string }>>([])
  const flushTimerRef = useRef<NodeJS.Timeout | null>(null)
  const tailRef = useRef('')
  const tailChannelRef = useRef<LogEntry['channel']>('stdout')
  const shuttingDownRef = useRef(false)
  const deferredLogs = useDeferredValue(logs)

  const refreshSnapshot = () => {
    const currentState = stateRef.current
    if (!currentState) {
      return
    }
    setSnapshot(getCliStatusSnapshot(currentState))
    setPromptLabel(stripAnsi(buildPromptLabel(currentState)).trim())
  }

  useEffect(() => {
    const flushPendingOutput = () => {
      flushTimerRef.current = null
      const queuedLogs = pendingLogsRef.current
      pendingLogsRef.current = []
      if (!queuedLogs.length) {
        return
      }
      setLogs(current =>
        keepTail(
          [
            ...current,
            ...queuedLogs.map(entry => ({
              id: `log-${logIdRef.current++}`,
              channel: entry.channel,
              text: entry.text || ' ',
            })),
          ],
          500,
        ),
      )
    }

    const scheduleFlush = () => {
      if (flushTimerRef.current) {
        return
      }
      flushTimerRef.current = setTimeout(flushPendingOutput, 30)
    }

    const enqueueOutput = (channel: LogEntry['channel'], chunk: string) => {
      const normalizedChunk = stripAnsi(chunk)
      const parsed = appendChunk(stdoutBufferRef.current, normalizedChunk)
      stdoutBufferRef.current = parsed.nextBuffer
      tailRef.current = parsed.nextBuffer
      tailChannelRef.current = channel
      if (parsed.lines.length) {
        pendingLogsRef.current.push(
          ...parsed.lines.map(line => ({
            channel,
            text: line || ' ',
          })),
        )
      }
      scheduleFlush()
    }

    const initialize = async () => {
      try {
        const args = process.argv.slice(2).filter(flag => flag !== '--tui')
        const options = parseCliArgs(args)
        const settings = await readSettings()
        const state = createFreshState(settings)
        stateRef.current = state

        setCliOutputTarget({
          write(text) {
            enqueueOutput('stdout', text)
          },
          clear() {
            stdoutBufferRef.current = ''
            tailRef.current = ''
            pendingLogsRef.current = []
            stdout.write('\x1Bc')
            setOutputEpoch(current => current + 1)
            setLogs([
              {
                id: `log-${logIdRef.current++}`,
                channel: 'system',
                text: 'Cleared view.',
              },
            ])
          },
        })
        setCliStructuredQuestionHandler(
          request =>
            new Promise<StructuredQuestionResponse>((resolve, reject) => {
              setQuestionSession({
                request,
                index: 0,
                answers: {},
                resolve,
                reject,
              })
              setStatus(
                `Agent requested ${request.questions.length} clarification ${
                  request.questions.length === 1 ? 'question' : 'questions'
                }`,
              )
            }),
        )

        const launchDirectory = path.resolve(
          process.env.ROYCODE_SHELL_CWD || process.cwd(),
        )
        await applyStartupOptions(state, options, launchDirectory)
        await startCliBackgroundServices(state)
        printBanner(state)
        refreshSnapshot()
        setStatus('RoyCode runtime ready')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to initialize RoyCode'
        setStatus(message)
        setLogs(current =>
          keepTail(
            [
              ...current,
              {
                id: `log-${logIdRef.current++}`,
                channel: 'stderr',
                text: message,
              },
            ],
            500,
          ),
        )
      }
    }

    void initialize()

    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      setCliOutputTarget(null)
      setCliStructuredQuestionHandler(null)
      if (questionSession) {
        questionSession.reject(new Error('RoyCode TUI closed before the question was answered'))
      }
      if (!shuttingDownRef.current && stateRef.current) {
        void saveCurrentSession(stateRef.current).catch(() => undefined)
      }
    }
  }, [])

  const resetView = (message: string) => {
    stdout.write('\x1Bc')
    stdoutBufferRef.current = ''
    tailRef.current = ''
    pendingLogsRef.current = []
    setOutputEpoch(current => current + 1)
    setLogs([
      {
        id: `log-${logIdRef.current++}`,
        channel: 'system',
        text: message,
      },
    ])
  }

  const shutdownAndExit = async () => {
    if (shuttingDownRef.current) {
      return
    }
    shuttingDownRef.current = true
    setStatus('Shutting down RoyCode...')
    setCliStructuredQuestionHandler(null)
    setCliOutputTarget(null)
    if (questionSession) {
      questionSession.reject(new Error('RoyCode TUI closed before the question was answered'))
      setQuestionSession(null)
    }
    if (stateRef.current) {
      await shutdownCliRuntime(stateRef.current).catch(() => undefined)
    }
    exit()
  }

  const runLocalCommand = async (value: string, shortcutLabel?: string) => {
    const currentState = stateRef.current
    if (!currentState) {
      return
    }
    if (shortcutLabel) {
      setLastShortcut(shortcutLabel)
    }
    const shouldContinue = await processInputLine(currentState, value)
    refreshSnapshot()
    if (!shouldContinue) {
      await shutdownAndExit()
    }
  }

  const submitStructuredQuestionAnswer = async (value: string) => {
    const current = questionSession
    if (!current) {
      return
    }
    const question = current.request.questions[current.index]!
    const resolved = resolveStructuredQuestionAnswer(value, question)
    if (!resolved) {
      setLogs(currentLogs =>
        keepTail(
          [
            ...currentLogs,
            {
              id: `log-${logIdRef.current++}`,
              channel: 'system',
              text: 'Please choose a valid option or provide a short answer.',
            },
          ],
          500,
        ),
      )
      return
    }

    const nextAnswers = {
      ...current.answers,
      [question.question]: resolved,
    }
    if (current.index >= current.request.questions.length - 1) {
      current.resolve({ answers: nextAnswers })
      setQuestionSession(null)
      setStatus('RoyCode runtime ready')
      refreshSnapshot()
      return
    }

    setQuestionSession({
      ...current,
      index: current.index + 1,
      answers: nextAnswers,
    })
  }

  const submitInput = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      return
    }

    if (questionSession) {
      await submitStructuredQuestionAnswer(trimmed)
      return
    }

    if (trimmed === '/clear') {
      resetView('Cleared view.')
      return
    }

    setHistory(current => keepTail([...current, trimmed], 8))
    setLogs(current =>
      keepTail(
        [
          ...current,
          {
            id: `log-${logIdRef.current++}`,
            channel: 'system',
            text: `> ${trimmed}`,
          },
        ],
        500,
      ),
    )
    await runLocalCommand(value)
  }

  useInput((value: string, key: Record<string, boolean>) => {
    if (key.ctrl && value === 'c') {
      void shutdownAndExit()
      return
    }
    if (questionSession) {
      return
    }
    if (key.ctrl && value === 'l') {
      setLastShortcut('Ctrl+L')
      resetView('Cleared view.')
      return
    }
    if (key.ctrl && value === 'd') {
      setLastShortcut('Ctrl+D')
      setShowInspector(current => !current)
      return
    }

    const shortcuts: Record<string, { command: string; label: string }> = {
      r: { command: '/status', label: 'Ctrl+R' },
      w: { command: '/context', label: 'Ctrl+W' },
      g: { command: '/git', label: 'Ctrl+G' },
      p: { command: '/pending', label: 'Ctrl+P' },
      j: { command: '/suggest', label: 'Ctrl+J' },
      y: { command: '/cron', label: 'Ctrl+Y' },
      k: { command: '/worktree', label: 'Ctrl+K' },
      o: { command: '/plan-mode status', label: 'Ctrl+O' },
      b: { command: '/brief toggle', label: 'Ctrl+B' },
      i: { command: '/thinkback', label: 'Ctrl+I' },
      s: { command: '/summary', label: 'Ctrl+S' },
    }

    if (key.ctrl && shortcuts[value]) {
      const shortcut = shortcuts[value]
      void runLocalCommand(shortcut.command, shortcut.label)
    }
  })

  const recentHistory = useMemo(() => [...history].reverse(), [history])
  const shortcutItems = useMemo<ShortcutItem[]>(
    () => [
      { keyLabel: 'Enter', action: 'send input' },
      { keyLabel: 'Ctrl+R', action: '/status' },
      { keyLabel: 'Ctrl+W', action: '/context' },
      { keyLabel: 'Ctrl+G', action: '/git' },
      { keyLabel: 'Ctrl+P', action: '/pending' },
      { keyLabel: 'Ctrl+J', action: '/suggest' },
      { keyLabel: 'Ctrl+Y', action: '/cron' },
      { keyLabel: 'Ctrl+K', action: '/worktree' },
      { keyLabel: 'Ctrl+O', action: '/plan-mode status' },
      { keyLabel: 'Ctrl+B', action: '/brief toggle' },
      { keyLabel: 'Ctrl+I', action: '/thinkback' },
      { keyLabel: 'Ctrl+S', action: '/summary' },
      { keyLabel: 'Ctrl+D', action: 'toggle inspector' },
      { keyLabel: 'Ctrl+L', action: 'clear view' },
      { keyLabel: 'Ctrl+C', action: 'exit' },
    ],
    [],
  )
  const compactStatusline = useMemo(
    () =>
      [
        `session=${snapshot.session}`,
        `workspace=${snapshot.workspace}`,
        `provider=${snapshot.provider}`,
        `model=${snapshot.model}`,
        `access=${snapshot.access}`,
        `policy=${snapshot.policy}`,
        `cwd=${snapshot.cwd}`,
      ].join(' | '),
    [snapshot],
  )

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <TuiHeader
        status={status}
        mode={snapshot.mode || 'interactive tui'}
        prompt={promptLabel}
        compactStatusline={compactStatusline}
      />

      {showInspector ? (
        <Box marginTop={1} flexDirection="row">
          <Box width={36} marginRight={1} flexDirection="column">
            <WorkspacePanel snapshot={snapshot} />
            <ShortcutsPanel shortcuts={shortcutItems} lastShortcut={lastShortcut} />
            <RecentInputPanel entries={recentHistory} />
          </Box>

          <SessionOutputPanel
            lines={deferredLogs}
            tail={tailRef.current}
            tailChannel={tailChannelRef.current}
            outputEpoch={outputEpoch}
          />
        </Box>
      ) : (
        <Box marginTop={1}>
          <SessionOutputPanel
            lines={deferredLogs}
            tail={tailRef.current}
            tailChannel={tailChannelRef.current}
            outputEpoch={outputEpoch}
          />
        </Box>
      )}

      {questionSession ? (
        <StructuredQuestionPanel
          question={questionSession.request.questions[questionSession.index]!}
          index={questionSession.index}
          total={questionSession.request.questions.length}
        />
      ) : null}

      <PromptComposer
        answerMode={Boolean(questionSession)}
        resetKey={questionSession ? `question-${questionSession.index}` : 'prompt'}
        onSubmit={submitInput}
      />
      <Box marginTop={1}>
        <Text color="gray">
          Tip: /help shows the full command surface. /clear only clears the local TUI view.
        </Text>
      </Box>
    </Box>
  )
}

function main(): void {
  if (!process.stdout.isTTY || shouldExitDirect(process.argv.slice(2))) {
    const launch = createCliLaunch()
    const child = spawn(launch.command, [...launch.args, ...process.argv.slice(2)], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        ROYCODE_SHELL_CWD: process.cwd(),
      },
    })
    child.on('close', code => {
      process.exit(code ?? 0)
    })
    child.on('error', error => {
      process.stderr.write(`${error instanceof Error ? error.message : 'Failed to launch RoyCode CLI'}\n`)
      process.exit(1)
    })
    return
  }

  render(<RoyCodeTui />)
}

main()
