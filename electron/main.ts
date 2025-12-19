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
    icon: path.join(process.env.VITE_PUBLIC, 'icon.png'),
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

    // Unified Launch Logic Variables
    let executablePath = appPath
    let isExecutable = appPath.toLowerCase().endsWith('.exe')
    let spawnOptions: any = { detached: true, stdio: 'ignore' }
    let spawnArgs: string[] = []

    // 1. Resolve Shortcut if needed
    if (appPath.toLowerCase().endsWith('.lnk')) {
      try {
        const shortcut = shell.readShortcutLink(appPath)
        win?.webContents.send('console-log', `[SHORTCUT DEBUG] Target: '${shortcut.target}' Args: '${shortcut.args}' CWD: '${shortcut.cwd}'`)

        if (shortcut.target) {
          if (shortcut.target.toLowerCase().endsWith('.exe')) {
            executablePath = shortcut.target
            isExecutable = true
            win?.webContents.send('console-log', `Resolved Target EXE: ${executablePath}`)
          } else {
            win?.webContents.send('console-log', `[WARNING] Shortcut target is not an .exe: ${shortcut.target}`)
          }

          if (shortcut.cwd) {
            spawnOptions.cwd = shortcut.cwd
          }

          if (shortcut.args) {
            // Heuristic argument parsing
            const matchArgs = shortcut.args.match(/(?:[^\s"]+|"[^"]*")+/g)
            if (matchArgs) {
              spawnArgs = matchArgs.map(a => a.replace(/^"|"$/g, ''))
            }
          }
        } else {
          win?.webContents.send('console-log', `[ERROR] Shortcut has no target!`)
        }
      } catch (e: any) {
        console.error('Failed to resolve shortcut', e)
        win?.webContents.send('console-log', `[ERROR] Failed to read shortcut: ${e.message}`)
      }
    }

    // Default CWD if missing
    if (!spawnOptions.cwd && isExecutable) {
      spawnOptions.cwd = path.dirname(executablePath)
    }

    win?.webContents.send('console-log', `Final Launch Config -> Exe: ${executablePath}, CWD: ${spawnOptions.cwd}, Args: ${JSON.stringify(spawnArgs)}`)

    // Global Error Handler to prevent crashes
    process.on('uncaughtException', (error) => {
      console.error('Uncaught Exception:', error)
      win?.webContents.send('console-log', `[SYSTEM ERROR] ${error.message}`)
    })

    if (isExecutable) {
      try {
        const child = spawn(executablePath, spawnArgs, spawnOptions)

        // EACCES Handling (Admin Rights Required)
        child.on('error', (err: any) => {
          if (err.code === 'EACCES') {
            win?.webContents.send('console-log', `[PERMISSION DENIED] requesting elevated privileges...`)

            // Fallback: Runas via PowerShell
            // Construct arguments for Start-Process
            let psArgs = `-FilePath "${executablePath}"`
            if (spawnOptions.cwd) {
              psArgs += ` -WorkingDirectory "${spawnOptions.cwd}"`
            }
            if (spawnArgs.length > 0) {
              // Re-escape for PowerShell
              const joinedArgs = spawnArgs.map(a => `\\"${a}\\"`).join(' ')
              psArgs += ` -ArgumentList "${joinedArgs}"`
            }

            psArgs += ` -Verb RunAs`

            win?.webContents.send('console-log', `[ELEVATED DEBUG] Command: Start-Process ${psArgs}`)

            const psCommand = `Start-Process ${psArgs}`
            const elevator = spawn('powershell', ['-Command', psCommand], { detached: true, stdio: 'ignore' })

            elevator.on('error', (e) => {
              win?.webContents.send('console-log', `[FATAL] Failed to elevate: ${e.message}`)
            })

            win?.webContents.send('app-status-change', { path: appPath, status: 'launched (elevated)' })
            // We lose PID tracking here, but at least the app launches.
            return;
          }
          win?.webContents.send('console-log', `Launch Error: ${err.message}`)
        })

        child.unref()

        // Only track if it didn't error immediately (approx. check)
        if (child.pid) {
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
                  // Recursive restart using same variables
                  const newChild = spawn(executablePath, spawnArgs, spawnOptions)
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
        }
      } catch (err: any) {
        return { success: false, message: err.message }
      }
    } else {
      shell.openPath(appPath)
      return { success: true, message: 'Launched via Shell. Monitoring restricted to exe files.' }
    }
  })

  ipcMain.handle('kill-app', async (_event, appPath) => {
    let killed = false

    // 1. Try killing by tracked PID
    const child = runningProcesses.get(appPath)
    if (child && child.pid) {
      try {
        await new Promise<void>((resolve, reject) => {
          treeKill(child.pid!, 'SIGKILL', (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
        win?.webContents.send('console-log', `Killed linked process (PID: ${child.pid})`)
        killed = true
      } catch (e: any) {
        win?.webContents.send('console-log', `Failed to kill linked process: ${e.message}`)
      }
    }

    // 2. Try killing by Process Name (Taskkill)
    // Priority: User Configured Name > Auto-Derived Name
    const fileName = path.basename(appPath)
    const appName = fileName.replace(/\.(lnk|exe|url)$/, '')
    const settings = appSettings.get(appName)

    let targetProcessName = settings && settings.processName ? settings.processName : ''

    // Auto-Derive if empty
    if (!targetProcessName && fileName.toLowerCase().endsWith('.exe')) {
      targetProcessName = fileName
    } else if (!targetProcessName && fileName.toLowerCase().endsWith('.lnk')) {
      // Try to derive from original shortcut target if possible
      try {
        const shortcut = shell.readShortcutLink(appPath)
        if (shortcut.target && shortcut.target.toLowerCase().endsWith('.exe')) {
          targetProcessName = path.basename(shortcut.target)
        }
      } catch { }
    }

    if (targetProcessName) {
      win?.webContents.send('console-log', `Attempting taskkill for: ${targetProcessName}`)

      try {
        await new Promise<void>((resolve, reject) => {
          const killProc = spawn('taskkill', ['/IM', targetProcessName, '/F'], { detached: false })

          let stderr = ''
          killProc.stderr.on('data', d => stderr += d.toString())

          killProc.on('close', (code) => {
            if (code === 0) {
              win?.webContents.send('console-log', `Standard kill successful for ${targetProcessName}`)
              killed = true
              resolve()
            } else if (stderr.includes('Access is denied') || code === 5) {
              // 3. Elevated Fallback
              win?.webContents.send('console-log', `[ACCESS DENIED] Standard kill failed. Attempting ELEVATED kill...`)

              // We use Start-Process with Verb RunAs to trigger UAC
              const psCommand = `Start-Process taskkill -ArgumentList "/F /IM ${targetProcessName}" -Verb RunAs`
              const elevator = spawn('powershell', ['-Command', psCommand], { stdio: 'ignore' })

              elevator.on('error', (e) => {
                win?.webContents.send('console-log', `Failed to elevate kill command: ${e.message}`)
                resolve()
              })

              elevator.on('close', () => {
                win?.webContents.send('console-log', `Elevated kill command sent.`)
                killed = true
                resolve()
              })
            } else {
              if (!stderr.includes('not found')) {
                win?.webContents.send('console-log', `Taskkill failed: ${stderr.trim()}`)
              }
              resolve()
            }
          })
        })
      } catch (e: any) {
        console.error(e)
      }
    }

    if (!killed) {
      win?.webContents.send('console-log', `Unable to kill ${appName}: No running process tracked and name derivation failed.`)
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
