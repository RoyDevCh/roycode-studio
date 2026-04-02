import process from 'node:process'
import { streamAgentChat } from './agent.js'
import { runHook } from './hooks.js'
import { sendLocalNotification } from './notifier.js'
import { readSettings } from './store.js'
import { appendTaskLog, getTask, updateTask } from './tasks.js'
import { recordUsageEvent } from './usage.js'

function readTaskId(argv: string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--id') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --id')
      }
      return value
    }
  }
  throw new Error('Usage: task-runner --id <task-id>')
}

async function main(): Promise<void> {
  const startedAtMs = Date.now()
  const taskId = readTaskId(process.argv.slice(2))
  const initialTask = await getTask(taskId)
  if (!initialTask) {
    throw new Error(`Task not found: ${taskId}`)
  }
  if (initialTask.stopRequestedAt || initialTask.status === 'cancelled') {
    await appendTaskLog(taskId, `[${new Date().toISOString()}] skipped because task was already cancelled`)
    return
  }

  const task = await updateTask(taskId, current => ({
    ...current,
    status: 'running',
    startedAt: new Date().toISOString(),
    error: undefined,
    runnerPid: process.pid,
  }))
  await appendTaskLog(task.id, `[${new Date().toISOString()}] running ${task.title}`)

  const settings = await readSettings()
  const provider =
    settings.providers.find(item => item.id === task.providerId) ?? settings.providers[0]

  if (!provider) {
    throw new Error('No providers are configured for task execution')
  }

  const runtimeSettings = {
    ...settings,
    workspaceRoot: task.workspaceRoot,
    accessMode: task.accessMode,
    safeWriteMode: task.safeWriteMode,
    selectedProviderId: provider.id,
    selectedModel: task.model,
  }

  let answer = ''

  try {
    const response = await streamAgentChat(
      provider,
      runtimeSettings,
      {
        providerId: provider.id,
        model: task.model,
        sessionId: task.id,
        cwd: task.cwd,
        messages: [
          ...task.baseMessages,
          {
            role: 'user',
            content: task.prompt,
          },
        ],
      },
      {
        async onEvent(event) {
          switch (event.type) {
            case 'status':
              await appendTaskLog(task.id, `[status] ${event.message}`)
              break
            case 'text-delta':
              answer += event.delta
              break
            case 'tool-start':
              await appendTaskLog(task.id, `[tool:start] ${event.name} ${event.input}`)
              break
            case 'tool-result':
              await appendTaskLog(task.id, `[tool:done] ${event.name} ${event.output}`)
              break
            case 'error':
              await appendTaskLog(task.id, `[error] ${event.error}`)
              break
            case 'final':
              break
          }
        },
      },
    )

    await appendTaskLog(task.id, `[${new Date().toISOString()}] completed`)
    await appendTaskLog(task.id, response.answer)
    await updateTask(task.id, current => ({
      ...current,
      status: 'completed',
      finishedAt: new Date().toISOString(),
      result: response.answer,
      error: undefined,
    }))
    await recordUsageEvent({
      source: 'task',
      providerId: provider.id,
      model: task.model,
      workspaceRoot: task.workspaceRoot,
      sessionId: task.id,
      taskId: task.id,
      success: true,
      durationMs: Date.now() - startedAtMs,
      toolCalls: response.toolEvents.length,
      inputChars: task.prompt.length,
      outputChars: response.answer.length,
    })
    if (settings.notificationsEnabled) {
      await sendLocalNotification(
        `RoyCode task completed: ${task.title}`,
        response.answer.slice(0, 180),
      ).catch(() => undefined)
    }
    await runHook('task-completed', {
      workspaceRoot: task.workspaceRoot,
      cwd: task.cwd,
      accessMode: task.accessMode,
      timeoutMs: Math.min(runtimeSettings.commandTimeoutMs, 15_000),
      sessionId: task.id,
      sessionTitle: task.title,
      prompt: task.prompt,
      assistant: response.answer,
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: 'completed',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown task runner error'
    const latest = await getTask(task.id)
    if (latest?.status === 'cancelled' || latest?.stopRequestedAt) {
      await appendTaskLog(task.id, `[${new Date().toISOString()}] cancelled`)
      return
    }
    await appendTaskLog(task.id, `[${new Date().toISOString()}] failed ${message}`)
    await updateTask(task.id, current => ({
      ...current,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: message,
      result: answer || current.result,
    }))
    await recordUsageEvent({
      source: 'task',
      providerId: provider.id,
      model: task.model,
      workspaceRoot: task.workspaceRoot,
      sessionId: task.id,
      taskId: task.id,
      success: false,
      durationMs: Date.now() - startedAtMs,
      toolCalls: 0,
      inputChars: task.prompt.length,
      outputChars: answer.length,
      error: message,
    }).catch(() => undefined)
    if (settings.notificationsEnabled) {
      await sendLocalNotification(
        `RoyCode task failed: ${task.title}`,
        message.slice(0, 180),
      ).catch(() => undefined)
    }
    await runHook('task-completed', {
      workspaceRoot: task.workspaceRoot,
      cwd: task.cwd,
      accessMode: task.accessMode,
      timeoutMs: Math.min(runtimeSettings.commandTimeoutMs, 15_000),
      sessionId: task.id,
      sessionTitle: task.title,
      prompt: task.prompt,
      assistant: answer,
      taskId: task.id,
      taskTitle: task.title,
      taskStatus: 'failed',
    }).catch(() => undefined)
    throw error
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : 'Unknown task runner error'
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
