#!/usr/bin/env node
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const target = path.join(__dirname, 'roycode.js')

const child = spawn(process.execPath, [target, '--dangerously-skip-permissions', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: 'inherit',
  env: process.env,
})

child.on('error', error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Failed to launch roycode-full'}\n`)
  process.exit(1)
})

child.on('close', code => {
  process.exit(code ?? 0)
})
