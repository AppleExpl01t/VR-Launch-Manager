import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import treeKill from 'tree-kill'

// const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
const LAUNCHER_FOLDER_NAME = 'VR app launcher'
const SETTINGS_FILE_NAME = 'app-settings.json'

// Store for managing running processes
const runningProcesses = new Map<string, any>() // path -> child_process
const appSettings = new Map<string, any>() // name -> settings object

function getLauncherPath() {
  return path.join(app.getPath('documents'), LAUNCHER_FOLDER_NAME)
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME)
}

function loadSettings() {
  try {
    const p = getSettingsPath()
    if (fs.existsSync(p)) {
      const data = fs.readFileSync(p, 'utf-8')
      const json = JSON.parse(data)
      for (const key in json) {
        appSettings.set(key, json[key])
      }
    }
  } catch (e) {
    console.error('Failed to load settings', e)
  }
}

function saveSettings() {
  try {
    const p = getSettingsPath()
    const obj: any = {}
    appSettings.forEach((v, k) => obj[k] = v)
    fs.writeFileSync(p, JSON.stringify(obj, null, 2))
  } catch (e) {
    console.error('Failed to save settings', e)
  }
}

function ensureLauncherFolder() {
  const p = getLauncherPath()
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true })
  }
  return p
}

function scanApps() {
  const folder = ensureLauncherFolder()
  const files = fs.readdirSync(folder)
  const apps = files
    .filter(f => f.endsWith('.lnk') || f.endsWith('.exe') || f.endsWith('.url'))
    .map((f, index) => {
      const name = f.replace(/\.(lnk|exe|url)$/, '')
      const settings = appSettings.get(name) || {}
      return {
        name,
        path: path.join(folder, f),
        type: path.extname(f),
        processName: settings.processName,
        autoRestart: settings.autoRestart,
        order: settings.order !== undefined ? settings.order : index + 1,
        launchDelay: settings.launchDelay || 0
      }
    })
    .sort((a, b) => (a.order || 0) - (b.order || 0))
  return apps
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    frame: false, // Custom UI
    transparent: true, // Glass effect
    backgroundColor: '#00000000', // Transparent bg
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // IPC Handlers
  ipcMain.handle('get-apps', () => {
    return scanApps()
  })

  ipcMain.handle('update-app-settings', (_event, appData) => {
    appSettings.set(appData.name, {
      processName: appData.processName,
      autoRestart: appData.autoRestart,
      order: appData.order,
      launchDelay: appData.launchDelay
    })
    saveSettings()
    return true
  })

  ipcMain.handle('save-app-orders', (_event, appNames: string[]) => {
    appNames.forEach((name, index) => {
      const current = appSettings.get(name) || {}
      appSettings.set(name, {
        ...current,
        order: index + 1
      })
    })
    saveSettings()
    return true
  })

  ipcMain.handle('launch-app', (_event, appPath) => {
    if (runningProcesses.has(appPath)) {
      return { success: false, message: 'App already running' }
    }

    win?.webContents.send('console-log', `Launching: ${appPath}`)

    // Check if we have settings for this app to handle custom monitoring logic
    const fileName = path.basename(appPath)
    const appName = fileName.replace(/\.(lnk|exe|url)$/, '')
    const settings = appSettings.get(appName) || {}

    let executablePath = appPath
    let isExecutable = appPath.toLowerCase().endsWith('.exe')

    // Try to resolve shortcut if it is a .lnk file
    if (appPath.toLowerCase().endsWith('.lnk')) {
      try {
        const shortcut = shell.readShortcutLink(appPath)
        if (shortcut.target && shortcut.target.toLowerCase().endsWith('.exe')) {
          executablePath = shortcut.target
          isExecutable = true
          win?.webContents.send('console-log', `Resolved shortcut to: ${executablePath}`)
        }
      } catch (e) {
        console.error('Failed to resolve shortcut', e)
      }
    }

    if (isExecutable) {
      const child = spawn(executablePath, [], { detached: true, stdio: 'ignore' })
      child.unref()

      runningProcesses.set(appPath, child)
      win?.webContents.send('app-status-change', { path: appPath, status: 'running' })

      child.on('exit', (code) => {
        runningProcesses.delete(appPath)
        win?.webContents.send('app-status-change', { path: appPath, status: 'stopped' })

        if (code !== 0 && code !== null) {
          win?.webContents.send('console-log', `App crashed or exited: ${appPath} (Code: ${code})`)

          if (settings.autoRestart) {
            win?.webContents.send('console-log', `[AUTO-RESTART] Restarting ${appName} in 3 seconds...`)
            setTimeout(() => {
              const newChild = spawn(executablePath, [], { detached: true, stdio: 'ignore' })
              newChild.unref()
              runningProcesses.set(appPath, newChild)
              win?.webContents.send('app-status-change', { path: appPath, status: 'running (restarted)' })

              win?.webContents.send('console-log', `[SYSTEM] Restarted ${appName}.`)
            }, 3000)
          }
        } else {
          win?.webContents.send('console-log', `App exited normally: ${appPath}`)
        }
      })

      return { success: true, pid: child.pid }
    } else {
      shell.openPath(appPath)
      return { success: true, message: 'Launched via Shell. Monitoring restricted to exe files.' }
    }
  })

  ipcMain.handle('kill-app', (_event, appPath) => {
    let killed = false

    // 1. Try killing by tracked PID
    const child = runningProcesses.get(appPath)
    if (child && child.pid) {
      treeKill(child.pid, 'SIGKILL', (err) => {
        if (err) {
          win?.webContents.send('console-log', `Failed to kill linked process: ${err.message}`)
        } else {
          win?.webContents.send('console-log', `Killed linked process (PID: ${child.pid})`)
        }
      })
      killed = true
    }

    // 2. Try killing by Process Name (Taskkill)
    const fileName = path.basename(appPath)
    const appName = fileName.replace(/\.(lnk|exe|url)$/, '')
    const settings = appSettings.get(appName)

    if (settings && settings.processName) {
      win?.webContents.send('console-log', `Attempting taskkill for: ${settings.processName}`)
      spawn('taskkill', ['/IM', settings.processName, '/F'], { detached: true, stdio: 'ignore' }).unref()
      killed = true
    }

    if (!killed) {
      win?.webContents.send('console-log', `Unable to kill ${appName}: No running process tracked and no Process Name configured.`)
      return false
    }

    return true
  })

  ipcMain.handle('open-folder', () => {
    shell.openPath(getLauncherPath())
  })

  // Window controls
  ipcMain.on('window-minimize', () => win?.minimize())
  ipcMain.on('window-maximize', () => {
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })
  ipcMain.on('window-close', () => win?.close())


  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  loadSettings()
  ensureLauncherFolder()
  createWindow()
})
