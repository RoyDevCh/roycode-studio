import express from 'express'
import cors from 'cors'
import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  runAgentChat,
  serializeAgentStreamEvent,
  streamAgentChat,
} from './agent.js'
import { registerCronWorkspace, startCronScheduler, stopCronScheduler } from './cron.js'
import { buildFileTree, runWorkspaceCommand } from './filesystem.js'
import {
  commitGitChanges,
  getGitDiff,
  getGitStatus,
  stageGitFile,
  unstageGitFile,
} from './git.js'
import {
  applyAllPendingChanges,
  applyPendingChange,
  commitWorkspaceChange,
  discardPendingChange,
  getWorkspaceFilePayload,
  listPendingChanges,
  stagePendingChange,
} from './pendingChanges.js'
import { createProviderFromPreset, PROVIDER_PRESETS } from './presets.js'
import { readSettings, toPublicSettings, writeSettings } from './store.js'
import { enableSleepGuard } from './sleepGuard.js'
import { summarizeUsage } from './usage.js'
import type { ProviderConfig, ProviderPresetId } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const APP_ROOT = path.resolve(__dirname, '..')
const DIST_ROOT = path.join(APP_ROOT, 'dist')
const PORT = Number(process.env.PORT ?? 8787)

const app = express()
app.use(cors())
app.use(express.json({ limit: '8mb' }))

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.map(item => item.trim()).filter(Boolean))]
}

function getProviderOrThrow(
  settings: Awaited<ReturnType<typeof readSettings>>,
  providerId: string,
) {
  const provider = settings.providers.find(item => item.id === providerId)
  if (!provider) {
    throw new Error('Provider not found')
  }
  return provider
}

async function fetchRemoteModels(provider: ProviderConfig): Promise<string[]> {
  if (!provider.apiKey) {
    return provider.models
  }

  const response = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
    headers: {
      authorization: `Bearer ${provider.apiKey}`,
      'content-type': 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`Model refresh failed: ${response.status} ${response.statusText}`)
  }

  const payload = (await response.json()) as { data?: Array<{ id?: string }> }
  const remoteModels = payload.data?.map(item => item.id).filter(Boolean) as
    | string[]
    | undefined
  if (!remoteModels?.length) {
    return provider.models
  }
  return uniqueModels([...provider.models, ...remoteModels])
}

const providerPayloadSchema = z.object({
  name: z.string().min(1).optional(),
  preset: z.enum(['deepseek', 'minimax', 'custom']).optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  models: z.array(z.string()).optional(),
  defaultModel: z.string().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().optional(),
})

const settingsPayloadSchema = z.object({
  appName: z.string().min(1).optional(),
  workspaceRoot: z.string().min(1).optional(),
  accessMode: z.enum(['workspace', 'unrestricted']).optional(),
  theme: z.enum(['dark', 'light', 'auto']).optional(),
  vimMode: z.boolean().optional(),
  briefMode: z.boolean().optional(),
  voiceMode: z.boolean().optional(),
  effortLevel: z.enum(['auto', 'low', 'medium', 'high', 'max']).optional(),
  promptSuggestionEnabled: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
  sleepGuardMode: z.boolean().optional(),
  advisorModel: z.string().optional(),
  outputStyle: z.string().min(1).optional(),
  cleanupPeriodDays: z.number().int().min(1).max(3650).optional(),
  defaultShell: z.enum(['powershell', 'bash']).optional(),
  enableAllProjectMcpServers: z.boolean().optional(),
  selectedProviderId: z.string().optional(),
  selectedModel: z.string().optional(),
  systemPrompt: z.string().min(1).optional(),
  commandTimeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxAgentSteps: z.number().int().min(1).max(16).optional(),
  safeWriteMode: z.boolean().optional(),
})

const fileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const pendingPathSchema = z.object({
  path: z.string().min(1),
})

const chatContentPartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image'),
    imageUrl: z.string().min(1),
    mimeType: z.string().optional(),
    detail: z.enum(['auto', 'low', 'high']).optional(),
  }),
])

const chatPayloadSchema = z.object({
  providerId: z.string().min(1),
  model: z.string().min(1),
  sessionId: z.string().optional(),
  cwd: z.string().optional(),
  systemAddenda: z.array(z.string()).optional(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.union([z.string(), z.array(chatContentPartSchema)]),
    }),
  ),
})

const commandPayloadSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
})

const gitPathSchema = z.object({
  path: z.string().min(1),
})

const gitStageSchema = z.object({
  path: z.string().min(1).optional(),
})

const gitCommitSchema = z.object({
  message: z.string().min(1),
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/usage', async (req, res, next) => {
  try {
    const windowDays = Math.max(
      1,
      Math.min(365, Number.parseInt(String(req.query.days ?? '7'), 10) || 7),
    )
    res.json({
      usage: await summarizeUsage(windowDays),
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/settings', async (_req, res, next) => {
  try {
    const settings = await readSettings()
    res.json({
      settings: toPublicSettings(settings),
      presets: PROVIDER_PRESETS,
    })
  } catch (error) {
    next(error)
  }
})

app.put('/api/settings', async (req, res, next) => {
  try {
    const payload = settingsPayloadSchema.parse(req.body)
    const settings = await readSettings()
    const nextSettings = {
      ...settings,
      ...payload,
    }
    await writeSettings(nextSettings)
    await registerCronWorkspace(nextSettings.workspaceRoot)
    await startCronScheduler([nextSettings.workspaceRoot])
    res.json({ settings: toPublicSettings(nextSettings) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/providers', async (req, res, next) => {
  try {
    const payload = z
      .object({
        preset: z.enum(['deepseek', 'minimax', 'custom']),
      })
      .parse(req.body)

    const settings = await readSettings()
    const provider = createProviderFromPreset(payload.preset)
    settings.providers.push(provider)
    settings.selectedProviderId = provider.id
    settings.selectedModel = provider.defaultModel
    await writeSettings(settings)

    res.json({ settings: toPublicSettings(settings) })
  } catch (error) {
    next(error)
  }
})

app.put('/api/providers/:id', async (req, res, next) => {
  try {
    const providerId = req.params.id
    const payload = providerPayloadSchema.parse(req.body)
    const settings = await readSettings()
    const provider = settings.providers.find(item => item.id === providerId)

    if (!provider) {
      res.status(404).json({ error: 'Provider not found' })
      return
    }

    provider.name = payload.name ?? provider.name
    provider.preset = (payload.preset as ProviderPresetId | undefined) ?? provider.preset
    provider.baseUrl = payload.baseUrl ?? provider.baseUrl
    provider.models = uniqueModels(payload.models ?? provider.models)
    provider.defaultModel = payload.defaultModel ?? provider.defaultModel ?? provider.models[0]
    provider.enabled = payload.enabled ?? provider.enabled
    provider.notes = payload.notes ?? provider.notes
    if (payload.apiKey && payload.apiKey.trim()) {
      provider.apiKey = payload.apiKey.trim()
    }

    if (settings.selectedProviderId === provider.id && provider.defaultModel) {
      settings.selectedModel = provider.defaultModel
    }

    await writeSettings(settings)
    res.json({ settings: toPublicSettings(settings) })
  } catch (error) {
    next(error)
  }
})

app.delete('/api/providers/:id', async (req, res, next) => {
  try {
    const providerId = req.params.id
    const settings = await readSettings()
    settings.providers = settings.providers.filter(item => item.id !== providerId)
    if (settings.selectedProviderId === providerId) {
      const nextProvider = settings.providers[0]
      settings.selectedProviderId = nextProvider?.id
      settings.selectedModel = nextProvider?.defaultModel
    }
    await writeSettings(settings)
    res.json({ settings: toPublicSettings(settings) })
  } catch (error) {
    next(error)
  }
})

app.post('/api/providers/:id/refresh-models', async (req, res, next) => {
  try {
    const settings = await readSettings()
    const provider = settings.providers.find(item => item.id === req.params.id)
    if (!provider) {
      res.status(404).json({ error: 'Provider not found' })
      return
    }

    provider.models = await fetchRemoteModels(provider)
    provider.defaultModel = provider.defaultModel ?? provider.models[0]
    await writeSettings(settings)

    res.json({ settings: toPublicSettings(settings) })
  } catch (error) {
    next(error)
  }
})

app.get('/api/workspace/tree', async (req, res, next) => {
  try {
    const settings = await readSettings()
    const targetPath = String(req.query.path ?? '.')
    const depth = Number(req.query.depth ?? 3)
    const tree = await buildFileTree(
      settings.workspaceRoot,
      targetPath,
      depth,
      settings.accessMode,
    )
    res.json({ tree })
  } catch (error) {
    next(error)
  }
})

app.get('/api/workspace/file', async (req, res, next) => {
  try {
    const settings = await readSettings()
    const requestedPath = String(req.query.path ?? '')
    const file = await getWorkspaceFilePayload(
      settings.workspaceRoot,
      requestedPath,
      settings.accessMode,
    )
    res.json(file)
  } catch (error) {
    next(error)
  }
})

app.put('/api/workspace/file', async (req, res, next) => {
  try {
    const payload = fileWriteSchema.parse(req.body)
    const settings = await readSettings()

    if (settings.safeWriteMode) {
      const staged = await stagePendingChange({
        workspaceRoot: settings.workspaceRoot,
        path: payload.path,
        content: payload.content,
        source: 'manual',
        accessMode: settings.accessMode,
      })
      res.json({ ok: true, mode: 'staged', pendingChange: staged })
      return
    }

    await commitWorkspaceChange({
      workspaceRoot: settings.workspaceRoot,
      path: payload.path,
      content: payload.content,
      accessMode: settings.accessMode,
    })
    res.json({ ok: true, mode: 'written' })
  } catch (error) {
    next(error)
  }
})

app.get('/api/pending-changes', async (_req, res, next) => {
  try {
    const changes = await listPendingChanges()
    res.json({ changes })
  } catch (error) {
    next(error)
  }
})

app.post('/api/pending-changes/stage', async (req, res, next) => {
  try {
    const payload = fileWriteSchema.parse(req.body)
    const settings = await readSettings()
    const change = await stagePendingChange({
      workspaceRoot: settings.workspaceRoot,
      path: payload.path,
      content: payload.content,
      source: 'manual',
      accessMode: settings.accessMode,
    })
    res.json({ ok: true, pendingChange: change })
  } catch (error) {
    next(error)
  }
})

app.post('/api/pending-changes/apply', async (req, res, next) => {
  try {
    const payload = pendingPathSchema.parse(req.body)
    const settings = await readSettings()
    const change = await applyPendingChange(
      settings.workspaceRoot,
      payload.path,
      settings.accessMode,
    )
    res.json({ ok: true, applied: change })
  } catch (error) {
    next(error)
  }
})

app.post('/api/pending-changes/reject', async (req, res, next) => {
  try {
    const payload = pendingPathSchema.parse(req.body)
    const settings = await readSettings()
    await discardPendingChange(
      settings.workspaceRoot,
      payload.path,
      settings.accessMode,
    )
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

app.post('/api/pending-changes/apply-all', async (_req, res, next) => {
  try {
    const settings = await readSettings()
    const applied = await applyAllPendingChanges(
      settings.workspaceRoot,
      settings.accessMode,
    )
    res.json({ ok: true, applied })
  } catch (error) {
    next(error)
  }
})

app.post('/api/workspace/command', async (req, res, next) => {
  try {
    const payload = commandPayloadSchema.parse(req.body)
    const settings = await readSettings()
    const output = await runWorkspaceCommand(
      settings.workspaceRoot,
      payload.command,
      payload.cwd ?? '.',
      payload.timeoutMs ?? settings.commandTimeoutMs,
      settings.accessMode,
    )
    res.json({
      ok: true,
      command: payload.command,
      cwd: payload.cwd ?? '.',
      output,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/api/git/status', async (_req, res, next) => {
  try {
    const settings = await readSettings()
    const status = await getGitStatus(settings.workspaceRoot)
    res.json(status)
  } catch (error) {
    next(error)
  }
})

app.get('/api/git/diff', async (req, res, next) => {
  try {
    const payload = gitPathSchema.parse(req.query)
    const settings = await readSettings()
    const diff = await getGitDiff(settings.workspaceRoot, payload.path)
    res.json(diff)
  } catch (error) {
    next(error)
  }
})

app.post('/api/git/stage', async (req, res, next) => {
  try {
    const payload = gitStageSchema.parse(req.body)
    const settings = await readSettings()
    await stageGitFile(settings.workspaceRoot, payload.path)
    const status = await getGitStatus(settings.workspaceRoot)
    res.json({ ok: true, status })
  } catch (error) {
    next(error)
  }
})

app.post('/api/git/unstage', async (req, res, next) => {
  try {
    const payload = gitPathSchema.parse(req.body)
    const settings = await readSettings()
    await unstageGitFile(settings.workspaceRoot, payload.path)
    const status = await getGitStatus(settings.workspaceRoot)
    res.json({ ok: true, status })
  } catch (error) {
    next(error)
  }
})

app.post('/api/git/commit', async (req, res, next) => {
  try {
    const payload = gitCommitSchema.parse(req.body)
    const settings = await readSettings()
    const result = await commitGitChanges(settings.workspaceRoot, payload.message.trim())
    const status = await getGitStatus(settings.workspaceRoot)
    res.json({ ok: true, summary: result.summary, status })
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', async (req, res, next) => {
  try {
    const payload = chatPayloadSchema.parse(req.body)
    const settings = await readSettings()
    const provider = getProviderOrThrow(settings, payload.providerId)

    settings.selectedProviderId = provider.id
    settings.selectedModel = payload.model
    await writeSettings(settings)

    const response = await runAgentChat(provider, settings, payload)
    res.json(response)
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat/stream', async (req, res) => {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')

  try {
    const payload = chatPayloadSchema.parse(req.body)
    const settings = await readSettings()
    const provider = getProviderOrThrow(settings, payload.providerId)

    settings.selectedProviderId = provider.id
    settings.selectedModel = payload.model
    await writeSettings(settings)

    await streamAgentChat(provider, settings, payload, {
      onEvent(event) {
        res.write(serializeAgentStreamEvent(event))
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    res.write(
      serializeAgentStreamEvent({
        type: 'error',
        error: message,
      }),
    )
  } finally {
    res.end()
  }
})

async function serveClientIfPresent(): Promise<void> {
  try {
    await access(path.join(DIST_ROOT, 'index.html'))
    app.use(express.static(DIST_ROOT))
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api')) {
        next()
        return
      }

      try {
        const html = await readFile(path.join(DIST_ROOT, 'index.html'), 'utf8')
        res.type('html').send(html)
      } catch (error) {
        next(error)
      }
    })
  } catch {
    app.get('/', (_req, res) => {
      res.json({
        message:
          'RoyCode Studio backend is running. Start the Vite dev server with `npm run dev` to open the WebUI.',
      })
    })
  }
}

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message = error instanceof Error ? error.message : 'Unknown server error'
    res.status(500).json({ error: message })
  },
)

await serveClientIfPresent()

const startupSettings = await readSettings()
await registerCronWorkspace(startupSettings.workspaceRoot)
await startCronScheduler([startupSettings.workspaceRoot])
if (startupSettings.sleepGuardMode) {
  await enableSleepGuard().catch(() => undefined)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stopCronScheduler().finally(() => {
      process.exit(0)
    })
  })
}

app.listen(PORT, () => {
  console.log(`RoyCode Studio is running on http://localhost:${PORT}`)
})
