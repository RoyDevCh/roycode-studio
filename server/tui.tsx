import React, {
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
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
  cwd: string
  status: string
  mode: string
  prompt: string
}): React.ReactElement {
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text bold color="cyan">
        RoyCode TUI
      </Text>
      <Text color="gray">cwd: {props.cwd}</Text>
      <Text color="gray">status: {props.status}</Text>
      <Text color="gray">mode: {props.mode}</Text>
      <Text color="gray">prompt: {props.prompt}</Text>
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
}): React.ReactElement {
  return (
    <Box flexGrow={1} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
      <Text bold color="green">
        Session Output
      </Text>
      {props.lines.map(entry => (
        <Text key={entry.id} color={formatChannelColor(entry.channel)}>
          {entry.text}
        </Text>
      ))}
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

function RoyCodeTui(): React.ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [input, setInput] = useState('')
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

  const maxVisibleLines = useMemo(() => {
    const height = stdout.rows || 32
    return Math.max(12, height - (questionSession ? 16 : 10))
  }, [stdout.rows, questionSession])

  const refreshSnapshot = () => {
    const currentState = stateRef.current
    if (!currentState) {
      return
    }
    setSnapshot(getCliStatusSnapshot(currentState))
    setPromptLabel(stripAnsi(buildPromptLabel(currentState)).trim())
  }

  useEffect(() => {
    let cancelled = false

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
      cancelled = true
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
      if (cancelled) {
        return
      }
    }
  }, [])

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
      setInput('')
      return
    }

    if (questionSession) {
      await submitStructuredQuestionAnswer(trimmed)
      setInput('')
      return
    }

    if (trimmed === '/clear') {
      stdoutBufferRef.current = ''
      tailRef.current = ''
      setLogs([
        {
          id: `log-${logIdRef.current++}`,
          channel: 'system',
          text: 'Cleared view.',
        },
      ])
      setInput('')
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
    setInput('')
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
      stdoutBufferRef.current = ''
      tailRef.current = ''
      setLogs([
        {
          id: `log-${logIdRef.current++}`,
          channel: 'system',
          text: 'Cleared view.',
        },
      ])
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
      { keyLabel: 'Ctrl+L', action: 'clear view' },
      { keyLabel: 'Ctrl+C', action: 'exit' },
    ],
    [],
  )
  const visibleLogs = useMemo(
    () => deferredLogs.slice(-maxVisibleLines),
    [deferredLogs, maxVisibleLines],
  )

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <TuiHeader
        cwd={process.cwd()}
        status={status}
        mode={snapshot.mode || 'interactive tui'}
        prompt={promptLabel}
      />

      <Box marginTop={1} flexDirection="row">
        <Box width={36} marginRight={1} flexDirection="column">
          <WorkspacePanel snapshot={snapshot} />
          <ShortcutsPanel shortcuts={shortcutItems} lastShortcut={lastShortcut} />
          <RecentInputPanel entries={recentHistory} />
        </Box>

        <SessionOutputPanel
          lines={visibleLogs}
          tail={tailRef.current}
          tailChannel={tailChannelRef.current}
        />
      </Box>

      {questionSession ? (
        <StructuredQuestionPanel
          question={questionSession.request.questions[questionSession.index]!}
          index={questionSession.index}
          total={questionSession.request.questions.length}
        />
      ) : null}

      <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">{questionSession ? 'answer' : '>'} </Text>
        <TextInput value={input} onChange={setInput} onSubmit={value => void submitInput(value)} />
      </Box>
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
