import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, render, Text, useApp, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

type StatusSnapshot = {
  session?: string
  messages?: string
  attachments?: string
  workspace?: string
  access?: string
  safeWrite?: string
  style?: string
  provider?: string
  model?: string
  cwd?: string
  skills?: string
  summaries?: string
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

function keepTail<T>(items: T[], max = 400): T[] {
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

function parseStatusSnapshot(line: string): Partial<StatusSnapshot> | null {
  const normalized = stripAnsi(line)
  if (!normalized.includes('|') || !normalized.includes('workspace ')) {
    return null
  }

  const result: Partial<StatusSnapshot> = {}
  const mappings: Array<[keyof StatusSnapshot, string]> = [
    ['session', 'session '],
    ['messages', 'messages '],
    ['attachments', 'attachments '],
    ['workspace', 'workspace '],
    ['access', 'access '],
    ['safeWrite', 'safe-write '],
    ['style', 'style '],
    ['provider', 'provider '],
    ['model', 'model '],
    ['cwd', 'cwd '],
    ['skills', 'skills '],
    ['summaries', 'summaries '],
  ]

  for (const segment of normalized.split('|').map(part => part.trim())) {
    for (const [key, prefix] of mappings) {
      if (segment.startsWith(prefix)) {
        result[key] = segment.slice(prefix.length).trim()
        break
      }
    }
  }

  return Object.keys(result).length ? result : null
}

function RoyCodeTui(): React.ReactElement {
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [input, setInput] = useState('')
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 'boot',
      channel: 'system',
      text: 'RoyCode TUI ready. Type /help for commands. Ctrl+L clears the view, Ctrl+R sends /status, Ctrl+W sends /context.',
    },
  ])
  const [status, setStatus] = useState('Launching RoyCode CLI...')
  const [snapshot, setSnapshot] = useState<StatusSnapshot>({})
  const [history, setHistory] = useState<string[]>([])
  const [lastShortcut, setLastShortcut] = useState('none')
  const childRef = useRef<ChildProcessWithoutNullStreams | null>(null)
  const stdoutBufferRef = useRef('')
  const stderrBufferRef = useRef('')
  const logIdRef = useRef(1)

  const maxVisibleLines = useMemo(() => {
    const height = stdout.rows || 32
    return Math.max(12, height - 10)
  }, [stdout.rows])

  useEffect(() => {
    const launch = createCliLaunch()
    const args = [...launch.args, ...process.argv.slice(2)]
    const child = spawn(launch.command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ROYCODE_SHELL_CWD: process.cwd(),
        ROYCODE_TUI: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    childRef.current = child
    setStatus(`CLI running (pid ${child.pid ?? 'n/a'})`)

    const pushLines = (channel: LogEntry['channel'], lines: string[]) => {
      if (!lines.length) {
        return
      }
      for (const line of lines) {
        const parsedStatus = parseStatusSnapshot(line)
        if (parsedStatus) {
          setSnapshot(current => ({ ...current, ...parsedStatus }))
        }
      }
      setLogs(current =>
        keepTail(
          [
            ...current,
            ...lines.map(text => ({
              id: `log-${logIdRef.current++}`,
              channel,
              text: text || ' ',
            })),
          ],
          500,
        ),
      )
    }

    child.stdout.on('data', chunk => {
      const parsed = appendChunk(stdoutBufferRef.current, chunk.toString())
      stdoutBufferRef.current = parsed.nextBuffer
      pushLines('stdout', parsed.lines)
    })

    child.stderr.on('data', chunk => {
      const parsed = appendChunk(stderrBufferRef.current, chunk.toString())
      stderrBufferRef.current = parsed.nextBuffer
      pushLines('stderr', parsed.lines)
    })

    child.on('error', error => {
      setLogs(current =>
        keepTail(
          [
            ...current,
            {
              id: `log-${logIdRef.current++}`,
              channel: 'stderr',
              text: error instanceof Error ? error.message : 'Failed to launch RoyCode CLI',
            },
          ],
          500,
        ),
      )
      setStatus('Failed to launch')
    })

    child.on('close', code => {
      if (stdoutBufferRef.current.trim()) {
        pushLines('stdout', [stdoutBufferRef.current.trimEnd()])
      }
      if (stderrBufferRef.current.trim()) {
        pushLines('stderr', [stderrBufferRef.current.trimEnd()])
      }
      setStatus(`CLI exited with code ${code ?? 0}`)
      setTimeout(() => exit(), 100)
    })

    child.stdin.write('/status\n')

    return () => {
      if (child.stdin.writable) {
        child.stdin.write('/exit\n')
      }
      if (!child.killed) {
        child.kill()
      }
    }
  }, [exit])

  useInput((value: string, key: Record<string, boolean>) => {
    if (key.ctrl && value === 'c') {
      if (childRef.current?.stdin.writable) {
        childRef.current.stdin.write('/exit\n')
      }
      exit()
      return
    }
    if (key.ctrl && value === 'l') {
      setLastShortcut('Ctrl+L')
      setLogs([
        {
          id: `log-${logIdRef.current++}`,
          channel: 'system',
          text: 'Cleared view.',
        },
      ])
      return
    }
    if (key.ctrl && value === 'r') {
      setLastShortcut('Ctrl+R')
      childRef.current?.stdin.write('/status\n')
      return
    }
    if (key.ctrl && value === 'w') {
      setLastShortcut('Ctrl+W')
      childRef.current?.stdin.write('/context\n')
      return
    }
    if (key.ctrl && value === 'g') {
      setLastShortcut('Ctrl+G')
      childRef.current?.stdin.write('/git\n')
      return
    }
    if (key.ctrl && value === 'p') {
      setLastShortcut('Ctrl+P')
      childRef.current?.stdin.write('/pending\n')
    }
  })

  const submitInput = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setInput('')
      return
    }
    if (trimmed === '/clear') {
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
    childRef.current?.stdin.write(`${value}\n`)
    setInput('')
  }

  const visibleLogs = logs.slice(-maxVisibleLines)
  const recentHistory = [...history].reverse()

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
        <Text bold color="cyan">
          RoyCode TUI
        </Text>
        <Text color="gray">
          cwd: {process.cwd()}
        </Text>
        <Text color="gray">
          status: {status}
        </Text>
        <Text color="gray">
          mode: interactive tui
        </Text>
      </Box>

      <Box marginTop={1} flexDirection="row">
        <Box width={34} marginRight={1} flexDirection="column">
          <Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
            <Text bold color="magenta">
              Workspace
            </Text>
            <Text color="gray">session: {snapshot.session ?? 'waiting for /status'}</Text>
            <Text color="gray">workspace: {snapshot.workspace ?? process.cwd()}</Text>
            <Text color="gray">cwd: {snapshot.cwd ?? '.'}</Text>
            <Text color="gray">provider: {snapshot.provider ?? 'unknown'}</Text>
            <Text color="gray">model: {snapshot.model ?? 'unknown'}</Text>
            <Text color="gray">access: {snapshot.access ?? 'unknown'}</Text>
            <Text color="gray">safe-write: {snapshot.safeWrite ?? 'unknown'}</Text>
            <Text color="gray">skills: {snapshot.skills ?? 'unknown'}</Text>
          </Box>

          <Box
            marginTop={1}
            borderStyle="round"
            borderColor="blue"
            paddingX={1}
            flexDirection="column"
          >
            <Text bold color="blue">
              Shortcuts
            </Text>
            <Text color="gray">Enter: send input</Text>
            <Text color="gray">Ctrl+R: /status</Text>
            <Text color="gray">Ctrl+W: /context</Text>
            <Text color="gray">Ctrl+G: /git</Text>
            <Text color="gray">Ctrl+P: /pending</Text>
            <Text color="gray">Ctrl+L: clear view</Text>
            <Text color="gray">Ctrl+C: exit</Text>
            <Text color="gray">last: {lastShortcut}</Text>
          </Box>

          <Box
            marginTop={1}
            borderStyle="round"
            borderColor="yellow"
            paddingX={1}
            flexDirection="column"
          >
            <Text bold color="yellow">
              Recent Input
            </Text>
            {recentHistory.length ? (
              recentHistory.map((entry, index) => (
                <Text key={`${index}-${entry}`} color="gray">
                  {truncateText(entry, 30)}
                </Text>
              ))
            ) : (
              <Text color="gray">No commands yet</Text>
            )}
          </Box>
        </Box>

        <Box flexGrow={1} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
          <Text bold color="green">
            Session Output
          </Text>
          {visibleLogs.map(entry => (
            <Text key={entry.id} color={formatChannelColor(entry.channel)}>
              {entry.text}
            </Text>
          ))}
        </Box>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow">{'>'} </Text>
        <TextInput value={input} onChange={setInput} onSubmit={submitInput} />
      </Box>
      <Box marginTop={1}>
        <Text color="gray">
          Tip: /help shows the full command surface. /clear only clears the local TUI view.
        </Text>
      </Box>
    </Box>
  )
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
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
