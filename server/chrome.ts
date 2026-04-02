import process from 'node:process'
import { spawn } from 'node:child_process'

export function buildBrowserSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`
}

export async function openUrlInBrowser(url: string): Promise<void> {
  const resolvedUrl = new URL(url).toString()

  let command: string
  let args: string[]

  if (process.platform === 'win32') {
    command = 'cmd.exe'
    args = ['/c', 'start', '', resolvedUrl]
  } else if (process.platform === 'darwin') {
    command = 'open'
    args = [resolvedUrl]
  } else {
    command = 'xdg-open'
    args = [resolvedUrl]
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    })
    child.on('error', reject)
    child.on('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
