import process from 'node:process'
import { spawn } from 'node:child_process'

export function describeNotifierSupport(): {
  supported: boolean
  mode: string
} {
  if (process.platform === 'win32') {
    return {
      supported: true,
      mode: 'windows-balloon-tip',
    }
  }

  return {
    supported: false,
    mode: 'unsupported',
  }
}

export async function sendLocalNotification(
  title: string,
  message: string,
): Promise<void> {
  const support = describeNotifierSupport()
  if (!support.supported) {
    throw new Error(`Local notifications are not supported on this platform (${support.mode})`)
  }

  const escapedTitle = title.replace(/'/g, "''").slice(0, 80)
  const escapedMessage = message.replace(/'/g, "''").slice(0, 220)
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$n = New-Object System.Windows.Forms.NotifyIcon',
    '$n.Icon = [System.Drawing.SystemIcons]::Information',
    `$n.BalloonTipTitle = '${escapedTitle}'`,
    `$n.BalloonTipText = '${escapedMessage}'`,
    '$n.Visible = $true',
    '$n.ShowBalloonTip(4000)',
    'Start-Sleep -Seconds 5',
    '$n.Dispose()',
  ].join('; ')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(stderr.trim() || `Notification exited with code ${code}`))
      }
    })
  })
}
