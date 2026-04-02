import process from 'node:process'
import { spawn } from 'node:child_process'

export function describeVoiceSupport(): {
  supported: boolean
  mode: string
} {
  if (process.platform === 'win32') {
    return {
      supported: true,
      mode: 'windows-speech-synthesis',
    }
  }

  return {
    supported: false,
    mode: 'unsupported',
  }
}

export async function speakText(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) {
    return
  }

  if (process.platform !== 'win32') {
    throw new Error('Local voice synthesis is currently implemented for Windows only')
  }

  const command = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.Speak($env:ROYCODE_TTS_TEXT)',
  ].join('; ')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        env: {
          ...process.env,
          ROYCODE_TTS_TEXT: trimmed.slice(0, 1200),
        },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
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
        reject(new Error(stderr.trim() || `Voice synthesis exited with code ${code}`))
      }
    })
  })
}
