import process from 'node:process'
import { spawn } from 'node:child_process'

export function describeVoiceSupport(): {
  supported: boolean
  mode: string
  inputSupported: boolean
  outputSupported: boolean
} {
  if (process.platform === 'win32') {
    return {
      supported: true,
      mode: 'windows-speech-synthesis',
      inputSupported: true,
      outputSupported: true,
    }
  }

  return {
    supported: false,
    mode: 'unsupported',
    inputSupported: false,
    outputSupported: false,
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

export async function listenForSpeech(
  timeoutSeconds = 8,
): Promise<{
  text: string
  durationSeconds: number
}> {
  if (process.platform !== 'win32') {
    throw new Error('Local voice input is currently implemented for Windows only')
  }

  const safeTimeout = Math.min(30, Math.max(3, Math.trunc(timeoutSeconds)))
  const command = [
    'Add-Type -AssemblyName System.Speech',
    '$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine',
    '$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
    '$engine.SetInputToDefaultAudioDevice()',
    `$result = $engine.Recognize([TimeSpan]::FromSeconds(${safeTimeout}))`,
    'if ($result -and $result.Text) { Write-Output $result.Text }',
  ].join('; ')

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Voice input exited with code ${code}`))
        return
      }
      const text = stdout.trim()
      if (!text) {
        reject(new Error('No speech recognized before timeout'))
        return
      }
      resolve({
        text,
        durationSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      })
    })
  })
}
