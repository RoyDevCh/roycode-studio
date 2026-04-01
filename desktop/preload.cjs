const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('roycodeDesktop', {
  isDesktop: true,
  pickWorkspaceFolder: () => ipcRenderer.invoke('desktop:pick-workspace-folder'),
  revealPath: filePath => ipcRenderer.invoke('desktop:reveal-path', filePath),
  openExternal: url => ipcRenderer.invoke('desktop:open-external', url),
  getInfo: () => ipcRenderer.invoke('desktop:get-info'),
  onWorkspaceSelected: callback => {
    if (typeof callback !== 'function') {
      return () => undefined
    }

    const listener = (_event, filePath) => callback(filePath)
    ipcRenderer.on('desktop:workspace-selected', listener)
    return () => ipcRenderer.removeListener('desktop:workspace-selected', listener)
  },
})
