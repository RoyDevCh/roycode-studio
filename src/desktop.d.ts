export {}

declare global {
  interface Window {
    roycodeDesktop?: {
      isDesktop: boolean
      pickWorkspaceFolder: () => Promise<string | null>
      revealPath: (filePath: string) => Promise<boolean>
      openExternal: (url: string) => Promise<boolean>
      getInfo: () => Promise<{ platform: string; version: string }>
      onWorkspaceSelected: (callback: (filePath: string) => void) => () => void
    }
  }
}
