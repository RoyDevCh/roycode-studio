#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const BUILT_CLI = path.join(APP_ROOT, 'dist-server', 'cli.js')
const BUILT_TUI = path.join(APP_ROOT, 'dist-server', 'tui.js')
const SOURCE_CLI = path.join(APP_ROOT, 'server', 'cli.ts')
const SOURCE_TUI = path.join(APP_ROOT, 'server', 'tui.tsx')
const TSX_CLI = path.join(APP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function run(command, args) {
  const launchCwd = process.cwd()
  const child = spawn(command, args, {
    cwd: launchCwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ROYCODE_SHELL_CWD: launchCwd,
    },
  })

  child.on('error', error => {
    fail(error instanceof Error ? error.message : 'Failed to launch RoyCode CLI')
  })

  child.on('close', code => {
    process.exit(code ?? 0)
  })
}

function shouldUseTui(argv) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    return false
  }

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

  return !argv.some(flag => directFlags.has(flag))
}

const passthroughArgs = process.argv
  .slice(2)
  .filter(flag => flag !== '--plain' && flag !== '--no-tui')

if (existsSync(BUILT_TUI) && shouldUseTui(process.argv.slice(2))) {
  run(process.execPath, [BUILT_TUI, ...passthroughArgs])
} else if (existsSync(BUILT_CLI)) {
  run(process.execPath, [BUILT_CLI, ...passthroughArgs])
} else if (existsSync(TSX_CLI) && shouldUseTui(process.argv.slice(2))) {
  run(process.execPath, [TSX_CLI, SOURCE_TUI, ...passthroughArgs])
} else if (existsSync(TSX_CLI)) {
  run(process.execPath, [TSX_CLI, SOURCE_CLI, ...passthroughArgs])
} else {
  fail('RoyCode CLI is not built yet. Run "npm install" and "npm run build" in personal-webui first.')
}
