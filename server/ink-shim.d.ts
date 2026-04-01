declare module 'ink' {
  import type React from 'react'

  export const Box: React.ComponentType<Record<string, unknown>>
  export const Text: React.ComponentType<Record<string, unknown>>

  export function render(node: React.ReactNode): {
    rerender(node: React.ReactNode): void
    unmount(): void
    waitUntilExit(): Promise<void>
    clear(): void
  }

  export function useApp(): {
    exit(): void
  }

  export function useInput(
    handler: (input: string, key: Record<string, boolean>) => void,
    options?: Record<string, unknown>,
  ): void

  export function useStdout(): {
    stdout: NodeJS.WriteStream
  }
}

declare module 'ink-text-input' {
  import type React from 'react'

  const TextInput: React.ComponentType<{
    value: string
    onChange(value: string): void
    onSubmit?(value: string): void
  }>

  export default TextInput
}
