import { spawn } from 'node:child_process'
import { resolveWorkspacePath } from './filesystem.js'
import type { GitChangedFile, GitDiffPayload, GitStatusPayload } from './types.js'

const MAX_GIT_OUTPUT = 40_000

function trimGitOutput(text: string): string {
  return text.length > MAX_GIT_OUTPUT ? `${text.slice(0, MAX_GIT_OUTPUT)}\n...[truncated]` : text
}

async function runGit(
  workspaceRoot: string,
  args: string[],
  cwd = '.',
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const resolvedCwd = resolveWorkspacePath(workspaceRoot, '.', cwd)

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
        stdout: trimGitOutput(stdout),
        stderr: trimGitOutput(stderr),
        exitCode: exitCode ?? 1,
      })
    })
  })
}

async function ensureGitRepo(workspaceRoot: string): Promise<boolean> {
  const result = await runGit(workspaceRoot, ['rev-parse', '--is-inside-work-tree'])
  return result.exitCode === 0 && result.stdout.trim() === 'true'
}

function parseBranchStatus(line: string): Pick<GitStatusPayload, 'branch' | 'ahead' | 'behind'> {
  const content = line.replace(/^##\s*/, '').trim()
  const bracketMatch = content.match(/\[(.+)\]$/)
  const branchPart = bracketMatch ? content.slice(0, bracketMatch.index).trim() : content
  const branch = branchPart.split('...')[0]?.trim() || 'detached'
  let ahead = 0
  let behind = 0

  if (bracketMatch) {
    const flags = bracketMatch[1]
    const aheadMatch = flags.match(/ahead\s+(\d+)/)
    const behindMatch = flags.match(/behind\s+(\d+)/)
    ahead = aheadMatch ? Number(aheadMatch[1]) : 0
    behind = behindMatch ? Number(behindMatch[1]) : 0
  }

  return { branch, ahead, behind }
}

function parseStatusLine(line: string): GitChangedFile | null {
  if (line.length < 3) {
    return null
  }

  const indexStatus = line[0] ?? ' '
  const workTreeStatus = line[1] ?? ' '
  const rawPath = line.slice(3).trim()
  if (!rawPath) {
    return null
  }

  let renamedFrom: string | undefined
  let nextPath = rawPath
  if (rawPath.includes(' -> ')) {
    const [from, to] = rawPath.split(/\s+->\s+/)
    renamedFrom = from
    nextPath = to ?? rawPath
  }

  const untracked = indexStatus === '?' || workTreeStatus === '?'

  return {
    path: nextPath,
    indexStatus,
    workTreeStatus,
    staged: !untracked && indexStatus !== ' ',
    unstaged: untracked || workTreeStatus !== ' ',
    untracked,
    renamedFrom,
  }
}

export async function getGitStatus(workspaceRoot: string): Promise<GitStatusPayload> {
  const isRepo = await ensureGitRepo(workspaceRoot)
  if (!isRepo) {
    return {
      isRepo: false,
      branch: '',
      ahead: 0,
      behind: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      files: [],
    }
  }

  const statusResult = await runGit(workspaceRoot, ['status', '--porcelain=1', '-b'])
  if (statusResult.exitCode !== 0) {
    throw new Error(statusResult.stderr || 'Failed to read git status')
  }

  const lines = statusResult.stdout.split(/\r?\n/).filter(Boolean)
  const branchInfo = lines[0]?.startsWith('##')
    ? parseBranchStatus(lines[0])
    : { branch: 'detached', ahead: 0, behind: 0 }

  const files = lines
    .slice(lines[0]?.startsWith('##') ? 1 : 0)
    .map(parseStatusLine)
    .filter((file): file is GitChangedFile => Boolean(file))

  return {
    isRepo: true,
    ...branchInfo,
    stagedCount: files.filter(file => file.staged).length,
    unstagedCount: files.filter(file => file.unstaged).length,
    untrackedCount: files.filter(file => file.untracked).length,
    files,
  }
}

export async function getGitDiff(
  workspaceRoot: string,
  filePath: string,
): Promise<GitDiffPayload> {
  const [unstaged, staged] = await Promise.all([
    runGit(workspaceRoot, ['diff', '--', filePath]),
    runGit(workspaceRoot, ['diff', '--staged', '--', filePath]),
  ])

  if (unstaged.exitCode !== 0 && staged.exitCode !== 0) {
    throw new Error(unstaged.stderr || staged.stderr || 'Failed to read git diff')
  }

  return {
    path: filePath,
    unstagedDiff: unstaged.stdout,
    stagedDiff: staged.stdout,
  }
}

export async function stageGitFile(workspaceRoot: string, filePath?: string): Promise<void> {
  const args = filePath ? ['add', '--', filePath] : ['add', '-A']
  const result = await runGit(workspaceRoot, args)
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to stage git changes')
  }
}

export async function unstageGitFile(workspaceRoot: string, filePath: string): Promise<void> {
  const result = await runGit(workspaceRoot, ['restore', '--staged', '--', filePath])
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to unstage git changes')
  }
}

export async function commitGitChanges(
  workspaceRoot: string,
  message: string,
): Promise<{ summary: string }> {
  const result = await runGit(workspaceRoot, ['commit', '-m', message])
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to create git commit')
  }

  return {
    summary: result.stdout || 'Commit created',
  }
}
