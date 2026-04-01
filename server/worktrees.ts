import path from 'node:path'
import { spawn } from 'node:child_process'
import { resolveWorkspacePath } from './filesystem.js'

export type GitWorktreeRecord = {
  path: string
  branch?: string
  head?: string
  bare: boolean
  detached: boolean
  locked: boolean
  prunable: boolean
}

async function runGit(
  workspaceRoot: string,
  args: string[],
  cwd = '.',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const resolvedCwd = resolveWorkspacePath(workspaceRoot, '.', cwd, 'workspace')

  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: resolvedCwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', exitCode => {
      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 1,
      })
    })
  })
}

export async function ensureGitRepo(workspaceRoot: string): Promise<void> {
  const result = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree'])
  if (result.exitCode !== 0 || result.stdout.trim() !== 'true') {
    throw new Error('Current workspace is not inside a git repository')
  }
}

function parseWorktreeList(output: string): GitWorktreeRecord[] {
  const records: GitWorktreeRecord[] = []
  let current: GitWorktreeRecord | null = null

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) {
      if (current) {
        records.push(current)
        current = null
      }
      continue
    }

    if (line.startsWith('worktree ')) {
      if (current) {
        records.push(current)
      }
      current = {
        path: line.slice('worktree '.length),
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
      }
      continue
    }

    if (!current) {
      continue
    }

    if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length)
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '')
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'detached') {
      current.detached = true
    } else if (line.startsWith('locked')) {
      current.locked = true
    } else if (line.startsWith('prunable')) {
      current.prunable = true
    }
  }

  if (current) {
    records.push(current)
  }

  return records
}

export async function listGitWorktrees(workspaceRoot: string): Promise<GitWorktreeRecord[]> {
  await ensureGitRepo(workspaceRoot)
  const result = await runGit(workspaceRoot, ['worktree', 'list', '--porcelain'])
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to list git worktrees')
  }
  return parseWorktreeList(result.stdout)
}

export async function addGitWorktree(args: {
  workspaceRoot: string
  targetPath: string
  branch?: string
  createBranch?: boolean
  base?: string
}): Promise<GitWorktreeRecord> {
  await ensureGitRepo(args.workspaceRoot)
  const gitArgs = ['worktree', 'add']

  if (args.createBranch && args.branch) {
    gitArgs.push('-b', args.branch)
  }

  gitArgs.push(args.targetPath)

  if (!args.createBranch && args.branch) {
    gitArgs.push(args.branch)
  } else if (args.base) {
    gitArgs.push(args.base)
  }

  const result = await runGit(args.workspaceRoot, gitArgs)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create git worktree')
  }

  const worktrees = await listGitWorktrees(args.workspaceRoot)
  const expectedPath = path.resolve(args.targetPath).toLowerCase().replace(/\\/g, '/')
  const created = worktrees.find(
    item => path.resolve(item.path).toLowerCase().replace(/\\/g, '/') === expectedPath,
  )
  if (!created) {
    throw new Error('Worktree was created but could not be discovered afterwards')
  }
  return created
}

export async function removeGitWorktree(
  workspaceRoot: string,
  targetPath: string,
  force = false,
): Promise<void> {
  await ensureGitRepo(workspaceRoot)
  const args = ['worktree', 'remove']
  if (force) {
    args.push('--force')
  }
  args.push(targetPath)
  const result = await runGit(workspaceRoot, args)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to remove git worktree')
  }
}

export async function pruneGitWorktrees(workspaceRoot: string): Promise<void> {
  await ensureGitRepo(workspaceRoot)
  const result = await runGit(workspaceRoot, ['worktree', 'prune'])
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to prune git worktrees')
  }
}

export async function findGitWorktree(
  workspaceRoot: string,
  reference: string,
): Promise<GitWorktreeRecord | null> {
  const normalized = reference.trim().toLowerCase()
  if (!normalized) {
    return null
  }
  const worktrees = await listGitWorktrees(workspaceRoot)
  return (
    worktrees.find(item => item.path.toLowerCase() === normalized) ??
    worktrees.find(item => item.branch?.toLowerCase() === normalized) ??
    worktrees.find(item => item.path.toLowerCase().includes(normalized)) ??
    worktrees.find(item => item.branch?.toLowerCase().includes(normalized)) ??
    null
  )
}
