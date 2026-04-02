import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const STATUS_PATH = path.join(DATA_DIR, 'sleep-guard.json')

type SleepGuardState = {
  pid?: number
  startedAt?: string
}

type SleepGuardStatus = {
  supported: boolean
  mode: string
  enabled: boolean
  pid?: number
  startedAt?: string
}

function describePlatform(): Pick<SleepGuardStatus, 'supported' | 'mode'> {
  if (process.platform === 'win32') {
    return {
      supported: true,
      mode: 'windows-setthreadexecutionstate',
    }
  }
  return {
    supported: false,
    mode: 'unsupported',
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

async function readState(): Promise<SleepGuardState> {
  await ensureDir()
  try {
    const raw = await readFile(STATUS_PATH, 'utf8')
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as SleepGuardState
  } catch {
    return {}
  }
}

async function writeState(state: SleepGuardState): Promise<void> {
  await ensureDir()
  await writeFile(STATUS_PATH, JSON.stringify(state, null, 2), 'utf8')
}

function isPidAlive(pid?: number): boolean {
  if (typeof pid !== 'number' || !Number.isFinite(pid)) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export async function getSleepGuardStatus(): Promise<SleepGuardStatus> {
  const platform = describePlatform()
  const state = await readState()
  const enabled = platform.supported && isPidAlive(state.pid)
  if (!enabled && state.pid) {
    await writeState({})
  }
  return {
    ...platform,
    enabled,
    pid: enabled ? state.pid : undefined,
    startedAt: enabled ? state.startedAt : undefined,
  }
}

export async function enableSleepGuard(): Promise<SleepGuardStatus> {
  const platform = describePlatform()
  if (!platform.supported) {
    throw new Error(`Sleep guard is not supported on this platform (${platform.mode})`)
  }
  const current = await getSleepGuardStatus()
  if (current.enabled) {
    return current
  }

  const script = [
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class RoyCodeSleepGuard {',
    '  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);',
    '}',
    '"@',
    '$flags = 0x80000003',
    'while ($true) {',
    '  [RoyCodeSleepGuard]::SetThreadExecutionState($flags) | Out-Null',
    '  Start-Sleep -Seconds 25',
    '}',
  ].join('\n')

  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  child.unref()

  const nextState: SleepGuardState = {
    pid: child.pid ?? undefined,
    startedAt: new Date().toISOString(),
  }
  await writeState(nextState)
  return getSleepGuardStatus()
}

export async function disableSleepGuard(): Promise<SleepGuardStatus> {
  const state = await readState()
  if (isPidAlive(state.pid)) {
    try {
      process.kill(state.pid as number)
    } catch {
      // ignore
    }
  }
  await rm(STATUS_PATH, { force: true })
  return getSleepGuardStatus()
}
