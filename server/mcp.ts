import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DATA_DIR = process.env.ROYCODE_DATA_DIR
  ? path.resolve(process.env.ROYCODE_DATA_DIR)
  : path.join(APP_ROOT, 'data')
const MCP_SERVERS_PATH = path.join(DATA_DIR, 'mcp-servers.json')

type McpStore = {
  servers: LocalMcpServerConfig[]
}

type BaseMcpServerConfig = {
  name: string
  transport: 'stdio' | 'streamable-http'
  enabled: boolean
  source?: 'data' | 'project-mcpjson'
}

export type StdioMcpServerConfig = BaseMcpServerConfig & {
  transport: 'stdio'
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
}

export type HttpMcpServerConfig = BaseMcpServerConfig & {
  transport: 'streamable-http'
  url: string
  headers?: Record<string, string>
}

export type LocalMcpServerConfig = StdioMcpServerConfig | HttpMcpServerConfig

function createStore(): McpStore {
  return { servers: [] }
}

function normalizeServerName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_ ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (!slug) {
    throw new Error('MCP server name must contain letters or numbers')
  }
  return slug
}

async function ensureStore(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  try {
    await readFile(MCP_SERVERS_PATH, 'utf8')
  } catch {
    await writeFile(MCP_SERVERS_PATH, JSON.stringify(createStore(), null, 2), 'utf8')
  }
}

async function readStore(): Promise<McpStore> {
  await ensureStore()
  const raw = await readFile(MCP_SERVERS_PATH, 'utf8')
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<McpStore>
  return {
    servers: Array.isArray(parsed.servers) ? parsed.servers : [],
  }
}

async function writeStore(store: McpStore): Promise<void> {
  await ensureStore()
  await writeFile(MCP_SERVERS_PATH, JSON.stringify(store, null, 2), 'utf8')
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await readFile(targetPath, 'utf8')
    return true
  } catch {
    return false
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sanitizeEnvironment(
  env: NodeJS.ProcessEnv | Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!env) {
    return undefined
  }

  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      next[key] = value
    }
  }
  return next
}

async function loadProjectMcpJsonServers(
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig[]> {
  if (!workspaceRoot) {
    return []
  }

  const targetPath = path.join(path.resolve(workspaceRoot), '.mcp.json')
  if (!(await pathExists(targetPath))) {
    return []
  }

  try {
    const raw = await readFile(targetPath, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as {
      mcpServers?: Record<string, Record<string, unknown>>
    }
    const servers = parsed.mcpServers ?? {}
    const output: LocalMcpServerConfig[] = []

    for (const [name, config] of Object.entries(servers)) {
      if (!config || typeof config !== 'object' || Array.isArray(config)) {
        continue
      }
      if (typeof config.command === 'string') {
        output.push({
          name: normalizeServerName(name),
          transport: 'stdio',
          enabled: true,
          command: config.command,
          args: Array.isArray(config.args)
            ? config.args.filter((item): item is string => typeof item === 'string')
            : [],
          cwd: typeof config.cwd === 'string' ? path.resolve(workspaceRoot, config.cwd) : undefined,
          env:
            config.env && typeof config.env === 'object' && !Array.isArray(config.env)
              ? Object.fromEntries(
                  Object.entries(config.env).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                )
              : undefined,
          source: 'project-mcpjson',
        })
      } else if (typeof config.url === 'string') {
        output.push({
          name: normalizeServerName(name),
          transport: 'streamable-http',
          enabled: true,
          url: config.url,
          headers:
            config.headers && typeof config.headers === 'object' && !Array.isArray(config.headers)
              ? Object.fromEntries(
                  Object.entries(config.headers).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                )
              : undefined,
          source: 'project-mcpjson',
        })
      }
    }

    return output
  } catch {
    return []
  }
}

export async function inspectProjectMcpJson(
  workspaceRoot?: string,
): Promise<{
  path: string | null
  exists: boolean
  valid: boolean
  serverCount: number
  error?: string
}> {
  if (!workspaceRoot) {
    return {
      path: null,
      exists: false,
      valid: true,
      serverCount: 0,
    }
  }

  const targetPath = path.join(path.resolve(workspaceRoot), '.mcp.json')
  if (!(await pathExists(targetPath))) {
    return {
      path: targetPath,
      exists: false,
      valid: true,
      serverCount: 0,
    }
  }

  try {
    const raw = await readFile(targetPath, 'utf8')
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as {
      mcpServers?: Record<string, unknown>
    }
    const serverCount =
      parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
        ? Object.keys(parsed.mcpServers).length
        : 0
    return {
      path: targetPath,
      exists: true,
      valid: true,
      serverCount,
    }
  } catch (error) {
    return {
      path: targetPath,
      exists: true,
      valid: false,
      serverCount: 0,
      error: error instanceof Error ? error.message : 'Unknown .mcp.json parse error',
    }
  }
}

export async function listMcpServers(
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig[]> {
  const store = await readStore()
  const projectServers =
    workspaceRoot && process.env.ROYCODE_ENABLE_ALL_PROJECT_MCP_SERVERS !== 'false'
      ? await loadProjectMcpJsonServers(workspaceRoot)
      : []
  const deduped = new Map<string, LocalMcpServerConfig>()

  for (const server of projectServers) {
    deduped.set(server.name, server)
  }
  for (const server of store.servers) {
    deduped.set(server.name, server)
  }

  return [...deduped.values()].sort((left, right) => left.name.localeCompare(right.name))
}

export async function getMcpServer(
  name: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig | null> {
  const normalized = normalizeServerName(name)
  const servers = await listMcpServers(workspaceRoot)
  return (
    servers.find(server => server.name === normalized) ??
    servers.find(server => server.name.startsWith(normalized)) ??
    servers.find(server => server.name.includes(normalized)) ??
    null
  )
}

function cloneServerForDataStore(server: LocalMcpServerConfig): LocalMcpServerConfig {
  if (server.transport === 'stdio') {
    return {
      ...cloneJson(server),
      source: 'data',
      env: server.env ? cloneJson(server.env) : undefined,
    }
  }
  return {
    ...cloneJson(server),
    source: 'data',
    headers: server.headers ? cloneJson(server.headers) : undefined,
  }
}

async function upsertMcpServer(server: LocalMcpServerConfig): Promise<LocalMcpServerConfig> {
  const store = await readStore()
  const index = store.servers.findIndex(item => item.name === server.name)
  if (index >= 0) {
    store.servers[index] = server
  } else {
    store.servers.push(server)
  }
  await writeStore(store)
  return server
}

export async function addStdioMcpServer(input: {
  name: string
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}): Promise<LocalMcpServerConfig> {
  const config: StdioMcpServerConfig = {
    name: normalizeServerName(input.name),
    transport: 'stdio',
    enabled: true,
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd ? path.resolve(input.cwd) : undefined,
    env: input.env ? cloneJson(input.env) : undefined,
  }
  return upsertMcpServer(config)
}

export async function addHttpMcpServer(input: {
  name: string
  url: string
  headers?: Record<string, string>
}): Promise<LocalMcpServerConfig> {
  const config: HttpMcpServerConfig = {
    name: normalizeServerName(input.name),
    transport: 'streamable-http',
    enabled: true,
    url: input.url,
    headers: input.headers ? cloneJson(input.headers) : undefined,
  }
  return upsertMcpServer(config)
}

export async function setMcpServerEnabled(
  name: string,
  enabled: boolean,
): Promise<LocalMcpServerConfig> {
  const store = await readStore()
  const normalized = normalizeServerName(name)
  const index = store.servers.findIndex(server => server.name === normalized)
  if (index < 0) {
    throw new Error(`MCP server not found: ${name}`)
  }
  const next = {
    ...store.servers[index],
    enabled,
  }
  store.servers[index] = next
  await writeStore(store)
  return next
}

export async function inspectMcpServer(
  name: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  const server = await getMcpServer(name, workspaceRoot)
  if (!server) {
    throw new Error(`MCP server not found: ${name}`)
  }
  return cloneJson(server)
}

async function updateStoredMcpServer(
  name: string,
  workspaceRoot: string | undefined,
  updater: (server: LocalMcpServerConfig) => LocalMcpServerConfig,
): Promise<LocalMcpServerConfig> {
  const current = await getMcpServer(name, workspaceRoot)
  if (!current) {
    throw new Error(`MCP server not found: ${name}`)
  }
  const next = updater(cloneServerForDataStore(current))
  next.name = normalizeServerName(next.name)
  next.enabled = next.enabled !== false
  next.source = 'data'
  return upsertMcpServer(next)
}

export async function setMcpServerHeader(
  name: string,
  key: string,
  value: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('Header name cannot be empty')
  }
  return updateStoredMcpServer(name, workspaceRoot, server => {
    if (server.transport !== 'streamable-http') {
      throw new Error('Headers can only be configured on Streamable HTTP MCP servers')
    }
    return {
      ...server,
      headers: {
        ...(server.headers ?? {}),
        [normalizedKey]: value,
      },
    }
  })
}

export async function unsetMcpServerHeader(
  name: string,
  key: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('Header name cannot be empty')
  }
  return updateStoredMcpServer(name, workspaceRoot, server => {
    if (server.transport !== 'streamable-http') {
      throw new Error('Headers can only be configured on Streamable HTTP MCP servers')
    }
    const nextHeaders = { ...(server.headers ?? {}) }
    delete nextHeaders[normalizedKey]
    return {
      ...server,
      headers: Object.keys(nextHeaders).length ? nextHeaders : undefined,
    }
  })
}

export async function setMcpServerEnv(
  name: string,
  key: string,
  value: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('Environment variable name cannot be empty')
  }
  return updateStoredMcpServer(name, workspaceRoot, server => {
    if (server.transport !== 'stdio') {
      throw new Error('Environment variables can only be configured on stdio MCP servers')
    }
    return {
      ...server,
      env: {
        ...(server.env ?? {}),
        [normalizedKey]: value,
      },
    }
  })
}

export async function unsetMcpServerEnv(
  name: string,
  key: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('Environment variable name cannot be empty')
  }
  return updateStoredMcpServer(name, workspaceRoot, server => {
    if (server.transport !== 'stdio') {
      throw new Error('Environment variables can only be configured on stdio MCP servers')
    }
    const nextEnv = { ...(server.env ?? {}) }
    delete nextEnv[normalizedKey]
    return {
      ...server,
      env: Object.keys(nextEnv).length ? nextEnv : undefined,
    }
  })
}

export async function setMcpServerBearerToken(
  name: string,
  token: string,
  workspaceRoot?: string,
): Promise<LocalMcpServerConfig> {
  return setMcpServerHeader(name, 'Authorization', `Bearer ${token.trim()}`, workspaceRoot)
}

export async function removeMcpServer(name: string): Promise<void> {
  const store = await readStore()
  const normalized = normalizeServerName(name)
  const before = store.servers.length
  store.servers = store.servers.filter(server => server.name !== normalized)
  if (store.servers.length === before) {
    throw new Error(`MCP server not found: ${name}`)
  }
  await writeStore(store)
}

async function withMcpClient<T>(
  serverName: string,
  workspaceRoot: string | undefined,
  callback: (client: Client, server: LocalMcpServerConfig) => Promise<T>,
): Promise<T> {
  const server = await getMcpServer(serverName, workspaceRoot)
  if (!server) {
    throw new Error(`MCP server not found: ${serverName}`)
  }
  if (!server.enabled) {
    throw new Error(`MCP server is disabled: ${server.name}`)
  }

  const client = new Client(
    {
      name: 'RoyCode',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  )

  const transport =
    server.transport === 'stdio'
      ? new StdioClientTransport({
          command: server.command,
          args: server.args,
          cwd: server.cwd,
          env: sanitizeEnvironment(server.env ? { ...process.env, ...server.env } : process.env),
          stderr: 'inherit',
        })
      : new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: server.headers
            ? {
                headers: server.headers,
              }
            : undefined,
        })

  await client.connect(transport)
  try {
    return await callback(client, server)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function listMcpTools(
  serverName: string,
  workspaceRoot?: string,
): Promise<Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.listTools()
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: cloneJson(tool.inputSchema as Record<string, unknown>),
    }))
  })
}

export async function callMcpTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown> = {},
  workspaceRoot?: string,
): Promise<Record<string, unknown>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.callTool(
      {
        name: toolName,
        arguments: args,
      },
      CallToolResultSchema,
    )
    return cloneJson(result as Record<string, unknown>)
  })
}

export async function listMcpPrompts(
  serverName: string,
  workspaceRoot?: string,
): Promise<Array<{ name: string; description?: string; arguments?: unknown[] }>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.listPrompts()
    return result.prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments ? cloneJson(prompt.arguments) : undefined,
    }))
  })
}

export async function getMcpPrompt(
  serverName: string,
  promptName: string,
  args: Record<string, string> = {},
  workspaceRoot?: string,
): Promise<Record<string, unknown>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.getPrompt({
      name: promptName,
      arguments: args,
    })
    return cloneJson(result as Record<string, unknown>)
  })
}

export async function listMcpResources(
  serverName: string,
  workspaceRoot?: string,
): Promise<Array<{ uri: string; name: string; description?: string; mimeType?: string }>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.listResources()
    return result.resources.map(resource => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    }))
  })
}

export async function readMcpResource(
  serverName: string,
  uri: string,
  workspaceRoot?: string,
): Promise<Record<string, unknown>> {
  return withMcpClient(serverName, workspaceRoot, async client => {
    const result = await client.readResource({
      uri,
    })
    return cloneJson(result as Record<string, unknown>)
  })
}
