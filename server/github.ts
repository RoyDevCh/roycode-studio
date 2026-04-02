import { runWorkspaceCommand } from './filesystem.js'
import { readSettings } from './store.js'

export type GitHubRepoRef = {
  owner: string
  repo: string
  remoteUrl: string
}

export type GitHubIssueSummary = {
  number: number
  title: string
  state: string
  author: string
  isPullRequest: boolean
  createdAt: string
  updatedAt: string
  url: string
}

export type GitHubIssueDetail = GitHubIssueSummary & {
  body: string
  labels: string[]
}

export type GitHubComment = {
  id: number
  author: string
  body: string
  createdAt: string
  updatedAt: string
  path?: string
  line?: number | null
  url: string
  kind: 'issue' | 'review'
}

function normalizeGitHubRemote(remoteUrl: string): GitHubRepoRef | null {
  const trimmed = remoteUrl.trim()
  if (!trimmed) {
    return null
  }

  const sshMatch = trimmed.match(/^git@github\.com:(.+?)\/(.+?)(?:\.git)?$/i)
  if (sshMatch) {
    return {
      owner: sshMatch[1] as string,
      repo: sshMatch[2] as string,
      remoteUrl: trimmed,
    }
  }

  const httpsMatch = trimmed.match(/^https?:\/\/github\.com\/(.+?)\/(.+?)(?:\.git)?$/i)
  if (httpsMatch) {
    return {
      owner: httpsMatch[1] as string,
      repo: httpsMatch[2] as string,
      remoteUrl: trimmed,
    }
  }

  return null
}

export async function resolveGitHubRepo(
  workspaceRoot: string,
  shell: 'powershell' | 'bash' = 'powershell',
): Promise<GitHubRepoRef | null> {
  try {
    const remoteUrl = await runWorkspaceCommand(
      workspaceRoot,
      'git remote get-url origin',
      '.',
      10_000,
      'unrestricted',
      undefined,
      shell,
    )
    return normalizeGitHubRemote(remoteUrl)
  } catch {
    return null
  }
}

async function readGitHubToken(
  workspaceRoot: string,
  shell: 'powershell' | 'bash' = 'powershell',
): Promise<string | null> {
  const fromEnv =
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_PAT?.trim()
  if (fromEnv) {
    return fromEnv
  }

  const settings = await readSettings().catch(() => null)
  const fromSettings =
    settings?.shellEnv?.GITHUB_TOKEN?.trim() ||
    settings?.shellEnv?.GH_TOKEN?.trim() ||
    settings?.shellEnv?.GITHUB_PAT?.trim()
  if (fromSettings) {
    return fromSettings
  }

  try {
    const token = await runWorkspaceCommand(
      workspaceRoot,
      'gh auth token',
      '.',
      8_000,
      'unrestricted',
      undefined,
      shell,
    )
    return token.trim() || null
  } catch {
    return null
  }
}

async function githubFetch<T>(
  workspaceRoot: string,
  apiPath: string,
  shell: 'powershell' | 'bash' = 'powershell',
): Promise<T> {
  const repo = await resolveGitHubRepo(workspaceRoot, shell)
  if (!repo) {
    throw new Error('Current workspace origin is not a GitHub repository')
  }

  const token = await readGitHubToken(workspaceRoot, shell)
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      accept: 'application/vnd.github+json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      'user-agent': 'roycode-studio',
    },
  })

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as T
}

export async function listGitHubIssues(
  workspaceRoot: string,
  options?: {
    state?: 'open' | 'closed' | 'all'
    limit?: number
    includePullRequests?: boolean
    shell?: 'powershell' | 'bash'
  },
): Promise<{ repo: GitHubRepoRef; issues: GitHubIssueSummary[] }> {
  const shell = options?.shell ?? 'powershell'
  const repo = await resolveGitHubRepo(workspaceRoot, shell)
  if (!repo) {
    throw new Error('Current workspace origin is not a GitHub repository')
  }

  const state = options?.state ?? 'open'
  const limit = Math.min(Math.max(options?.limit ?? 10, 1), 50)
  const payload = await githubFetch<Array<Record<string, unknown>>>(
    workspaceRoot,
    `/repos/${repo.owner}/${repo.repo}/issues?state=${state}&per_page=${limit}`,
    shell,
  )

  const issues = payload
    .map(item => {
      const issue: GitHubIssueSummary = {
        number: Number(item.number ?? 0),
        title: String(item.title ?? ''),
        state: String(item.state ?? ''),
        author: String((item.user as { login?: string } | undefined)?.login ?? 'unknown'),
        isPullRequest: Boolean(item.pull_request),
        createdAt: String(item.created_at ?? ''),
        updatedAt: String(item.updated_at ?? ''),
        url: String(item.html_url ?? ''),
      }
      return issue
    })
    .filter(item => item.number > 0)
    .filter(item => (options?.includePullRequests ? true : !item.isPullRequest))

  return { repo, issues }
}

export async function getGitHubIssue(
  workspaceRoot: string,
  issueNumber: number,
  shell: 'powershell' | 'bash' = 'powershell',
): Promise<{ repo: GitHubRepoRef; issue: GitHubIssueDetail }> {
  const repo = await resolveGitHubRepo(workspaceRoot, shell)
  if (!repo) {
    throw new Error('Current workspace origin is not a GitHub repository')
  }

  const payload = await githubFetch<Record<string, unknown>>(
    workspaceRoot,
    `/repos/${repo.owner}/${repo.repo}/issues/${issueNumber}`,
    shell,
  )

  return {
    repo,
    issue: {
      number: Number(payload.number ?? issueNumber),
      title: String(payload.title ?? ''),
      state: String(payload.state ?? ''),
      author: String((payload.user as { login?: string } | undefined)?.login ?? 'unknown'),
      isPullRequest: Boolean(payload.pull_request),
      createdAt: String(payload.created_at ?? ''),
      updatedAt: String(payload.updated_at ?? ''),
      url: String(payload.html_url ?? ''),
      body: String(payload.body ?? ''),
      labels: Array.isArray(payload.labels)
        ? payload.labels
            .map(item => String((item as { name?: string }).name ?? '').trim())
            .filter(Boolean)
        : [],
    },
  }
}

export async function listPullRequestComments(
  workspaceRoot: string,
  pullNumber: number,
  shell: 'powershell' | 'bash' = 'powershell',
): Promise<{ repo: GitHubRepoRef; comments: GitHubComment[] }> {
  const repo = await resolveGitHubRepo(workspaceRoot, shell)
  if (!repo) {
    throw new Error('Current workspace origin is not a GitHub repository')
  }

  const [issueComments, reviewComments] = await Promise.all([
    githubFetch<Array<Record<string, unknown>>>(
      workspaceRoot,
      `/repos/${repo.owner}/${repo.repo}/issues/${pullNumber}/comments?per_page=100`,
      shell,
    ),
    githubFetch<Array<Record<string, unknown>>>(
      workspaceRoot,
      `/repos/${repo.owner}/${repo.repo}/pulls/${pullNumber}/comments?per_page=100`,
      shell,
    ).catch(() => []),
  ])

  const comments: GitHubComment[] = [
    ...issueComments.map(item => ({
      id: Number(item.id ?? 0),
      author: String((item.user as { login?: string } | undefined)?.login ?? 'unknown'),
      body: String(item.body ?? ''),
      createdAt: String(item.created_at ?? ''),
      updatedAt: String(item.updated_at ?? ''),
      url: String(item.html_url ?? ''),
      kind: 'issue' as const,
    })),
    ...reviewComments.map(item => ({
      id: Number(item.id ?? 0),
      author: String((item.user as { login?: string } | undefined)?.login ?? 'unknown'),
      body: String(item.body ?? ''),
      createdAt: String(item.created_at ?? ''),
      updatedAt: String(item.updated_at ?? ''),
      path: item.path ? String(item.path) : undefined,
      line: typeof item.line === 'number' ? item.line : null,
      url: String(item.html_url ?? ''),
      kind: 'review' as const,
    })),
  ].filter(item => item.id > 0)

  comments.sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  return { repo, comments }
}
