const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron')
const path = require('node:path')
const { spawn } = require('node:child_process')
const net = require('node:net')
const { existsSync } = require('node:fs')
const { pathToFileURL } = require('node:url')

const APP_ROOT = path.resolve(__dirname, '..')
const PRELOAD_PATH = path.join(__dirname, 'preload.cjs')

let mainWindow = null
let backendProcess = null
let backendPort = null
let backendImportPromise = null

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function compiledBackendEntry() {
  return path.join(APP_ROOT, 'dist-server', 'index.js')
}

function backendEnv(port) {
  return {
    ...process.env,
    PORT: String(port),
    ROYCODE_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    ROYCODE_DEFAULT_WORKSPACE_ROOT: app.getPath('documents') || app.getPath('home'),
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate a local port'))
          return
        }
        resolve(address.port)
      })
    })
  })
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  throw new Error(`Timed out waiting for backend at ${url}`)
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill()
  }
  backendProcess = null
}

async function startBackend(port) {
  if (backendProcess || backendImportPromise) {
    return
  }

  const env = backendEnv(port)
  Object.assign(process.env, env)

  const compiledEntry = compiledBackendEntry()
  if (app.isPackaged || existsSync(compiledEntry)) {
    backendImportPromise = import(`${pathToFileURL(compiledEntry).href}?t=${Date.now()}`)
    await backendImportPromise
    return
  }

  backendProcess = spawn(npmCommand(), ['run', 'start'], {
    cwd: APP_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  backendProcess.stdout.on('data', chunk => {
    process.stdout.write(`[roycode-backend] ${chunk}`)
  })
  backendProcess.stderr.on('data', chunk => {
    process.stderr.write(`[roycode-backend] ${chunk}`)
  })
  backendProcess.on('exit', () => {
    backendProcess = null
  })
}

async function promptWorkspaceFolder() {
  const result = await dialog.showOpenDialog({
    title: 'Choose Workspace Folder',
    properties: ['openDirectory', 'createDirectory'],
  })

  if (result.canceled) {
    return null
  }

  return result.filePaths[0] ?? null
}

async function chooseWorkspaceFolderAndNotify() {
  const nextFolder = await promptWorkspaceFolder()
  if (nextFolder && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:workspace-selected', nextFolder)
  }
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Workspace...',
          accelerator: 'Ctrl+O',
          click: () => {
            void chooseWorkspaceFolderAndNotify()
          },
        },
        { type: 'separator' },
        {
          label: 'New Window',
          accelerator: 'Ctrl+Shift+N',
          click: () => {
            void createMainWindow()
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'Pick Workspace Folder',
          accelerator: 'Ctrl+Shift+O',
          click: () => {
            void chooseWorkspaceFolderAndNotify()
          },
        },
        {
          label: 'Open Git Panel',
          accelerator: 'Ctrl+Shift+G',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('desktop:workspace-selected', '__ROYCODE_DESKTOP_OPEN_GIT__')
            }
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createMainWindow() {
  if (!backendPort) {
    backendPort = await findFreePort()
    await startBackend(backendPort)
    await waitForServer(`http://127.0.0.1:${backendPort}/api/health`)
  }

  const window = new BrowserWindow({
    width: 1560,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    title: 'RoyCode Studio Desktop',
    backgroundColor: '#f6f7fb',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: PRELOAD_PATH,
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  await window.loadURL(`http://127.0.0.1:${backendPort}/`)
  mainWindow = window
  return window
}

ipcMain.handle('desktop:pick-workspace-folder', async () => promptWorkspaceFolder())
ipcMain.handle('desktop:reveal-path', async (_event, filePath) => {
  if (!filePath) {
    return false
  }
  shell.showItemInFolder(filePath)
  return true
})
ipcMain.handle('desktop:open-external', async (_event, url) => {
  if (!url) {
    return false
  }
  await shell.openExternal(url)
  return true
})
ipcMain.handle('desktop:get-info', async () => ({
  platform: process.platform,
  version: app.getVersion(),
}))

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow()
  }
})

app.on('before-quit', () => {
  stopBackend()
})

app.whenReady().then(async () => {
  buildMenu()
  await createMainWindow()
})
