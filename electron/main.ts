import { app, BrowserWindow, shell, ipcMain, protocol, nativeImage } from 'electron'
import { join, extname, normalize } from 'node:path'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import { registerScannerHandlers } from './ipc/scanner'
import { registerYtDlpHandlers, syncFolderTracks } from './ipc/ytdlp'
import { initDb } from './db/database'
import { registerDbHandlers } from './db/dbHandlers'
import { registerUpdaterHandlers, checkForUpdatesQuietly, cleanupOldInstallers } from './ipc/updater'

if (process.platform === 'win32') {
  app.setAppUserModelId('com.zphase.music')
}

const isDev = process.env.NODE_ENV === 'development'


function getAppIcon(): nativeImage | string {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(process.resourcesPath, 'icon.png'),
    join(__dirname, '../../resources/icon.ico'),
    join(__dirname, '../../resources/icon.png'),
    join(__dirname, '../../build/icon.ico'),
    join(__dirname, '../../build/icon.png'),
    join(app.getAppPath(), 'resources/icon.ico'),
    join(app.getAppPath(), 'resources/icon.png'),
    join(app.getAppPath(), 'electron/icon.png'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) {
        return img
      }
    }
  }
  return ''
}

function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  switch (ext) {
    case '.mp3': return 'audio/mpeg'
    case '.m4a':
    case '.aac': return 'audio/mp4'
    case '.flac': return 'audio/flac'
    case '.wav': return 'audio/wav'
    case '.ogg': return 'audio/ogg'
    case '.opus': return 'audio/opus'
    case '.webm': return 'audio/webm'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.png': return 'image/png'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

// ─── Register custom 'lokal' scheme BEFORE app is ready ──────────
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lokal',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
      bypassCSP: true,
    }
  }
])

let mainWindow: BrowserWindow | null = null
let miniPlayerWindow: BrowserWindow | null = null

// ─── Main window ─────────────────────────────────────────────────
function createWindow(): void {
  const icon = getAppIcon()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    icon,
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('maximize', () => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('window:maximized-change', true)
  })
  mainWindow.on('unmaximize', () => {
    if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('window:maximized-change', false)
  })
  mainWindow.on('enter-full-screen', () => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send('window:fullscreen-change', true)
      mainWindow?.webContents.send('window:maximized-change', true)
    }
  })
  mainWindow.on('leave-full-screen', () => {
    if (!mainWindow?.isDestroyed()) {
      mainWindow?.webContents.send('window:fullscreen-change', false)
      mainWindow?.webContents.send('window:maximized-change', mainWindow?.isMaximized() ?? false)
    }
  })
  // When main window is about to close, gracefully shut down mini player first
  mainWindow.on('close', () => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.removeAllListeners('closed')
      miniPlayerWindow.close()
      miniPlayerWindow = null
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ─── Mini player window ───────────────────────────────────────────
function createMiniPlayer(): void {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.focus()
    return
  }

  const icon = getAppIcon()
  miniPlayerWindow = new BrowserWindow({
    width: 300,
    height: 390,
    minWidth: 240,
    minHeight: 300,
    maxWidth: 520,
    maxHeight: 640,
    alwaysOnTop: true,
    resizable: true,
    movable: true,
    frame: false,
    transparent: false,
    icon,
    backgroundColor: '#1a1a1a',
    show: false,
    skipTaskbar: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  miniPlayerWindow.on('ready-to-show', () => miniPlayerWindow?.show())

  miniPlayerWindow.on('closed', () => {
    miniPlayerWindow = null
    // Notify main window so it can update its button state (guard against destroyed)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('miniplayer:closed')
    }
  })

  // Load the same renderer with the miniplayer hash route
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    miniPlayerWindow.loadURL(process.env['ELECTRON_RENDERER_URL'] + '#/miniplayer')
  } else {
    miniPlayerWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/miniplayer' })
  }
}

// ─── App startup ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  // lokal:// protocol for local audio/image files with HTTP Range (seeking) support
  protocol.handle('lokal', (request) => {
    try {
      const prefix = 'lokal://media/'
      let rawPath = request.url
      if (rawPath.startsWith(prefix)) {
        rawPath = rawPath.slice(prefix.length)
      } else {
        rawPath = rawPath.replace(/^lokal:\/\/[^/]*\//, '')
      }
      const decodedPath = decodeURIComponent(rawPath)
      const cleanPath = decodedPath.replace(/^[/\\]+([a-zA-Z]:)/, '$1')
      const filePath = normalize(cleanPath)

      if (!fs.existsSync(filePath)) {
        console.warn('[lokal protocol] File not found:', filePath)
        return new Response('Not found', { status: 404 })
      }

      const stat = fs.statSync(filePath)
      const fileSize = stat.size
      const mimeType = getMimeType(filePath)
      const rangeHeader = request.headers.get('range')

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : fileSize - 1
          const clampedStart = Math.max(0, Math.min(start, fileSize - 1))
          const clampedEnd = Math.min(Math.max(clampedStart, end), fileSize - 1)
          const chunkSize = clampedEnd - clampedStart + 1

          const nodeStream = fs.createReadStream(filePath, { start: clampedStart, end: clampedEnd })
          const webStream = Readable.toWeb(nodeStream) as ReadableStream

          return new Response(webStream, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Range': `bytes ${clampedStart}-${clampedEnd}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': chunkSize.toString(),
              'Content-Type': mimeType,
            }
          })
        }
      }

      const nodeStream = fs.createReadStream(filePath)
      const webStream = Readable.toWeb(nodeStream) as ReadableStream
      return new Response(webStream, {
        status: 200,
        headers: {
          'Accept-Ranges': 'bytes',
          'Content-Length': fileSize.toString(),
          'Content-Type': mimeType,
        }
      })
    } catch (err) {
      console.error('[lokal protocol] Error serving file:', request.url, err)
      return new Response('Internal server error', { status: 500 })
    }
  })

  await initDb()
  registerScannerHandlers()
  registerDbHandlers()
  registerYtDlpHandlers()

  // Background auto-sync of downloaded music folder on app startup
  setTimeout(() => {
    syncFolderTracks().catch((err) => {
      console.error('[Startup Sync] Failed to sync music folder:', err)
    })
  }, 1000)

  // Clean up leftover installer files from a previous update session
  cleanupOldInstallers()

  // Auto-start on login — only in packaged production builds, not during development
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        path: process.execPath,
      })
      console.log('[AutoLaunch] Configured openAtLogin: true for:', process.execPath)
    } catch (err) {
      console.error('[AutoLaunch] Failed to set login item settings:', err)
    }
  }

  ipcMain.handle('app:get-autostart', () => {
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('app:set-autostart', (_e, enable: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enable,
      path: process.execPath
    })
    return app.getLoginItemSettings().openAtLogin
  })

  // Window controls (for custom title bar)
  ipcMain.handle('window:minimize', () => BrowserWindow.getFocusedWindow()?.minimize())
  ipcMain.handle('window:maximize', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return
    if (win.isFullScreen()) {
      win.setFullScreen(false)
      return
    }
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.handle('window:close', () => BrowserWindow.getFocusedWindow()?.close())
  ipcMain.handle('window:isMaximized', () => {
    const win = BrowserWindow.getFocusedWindow()
    return win ? (win.isMaximized() || win.isFullScreen()) : false
  })
  ipcMain.handle('window:toggleFullScreen', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) {
      const nextState = !win.isFullScreen()
      win.setFullScreen(nextState)
    }
  })
  ipcMain.handle('window:isFullScreen', () => BrowserWindow.getFocusedWindow()?.isFullScreen() ?? false)

  // Shell helpers
  ipcMain.handle('shell:show-in-folder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // ── Mini player IPC ──────────────────────────────────────────
  // Open mini player
  ipcMain.handle('miniplayer:open', () => createMiniPlayer())

  // Close mini player
  ipcMain.handle('miniplayer:close', () => {
    miniPlayerWindow?.close()
    miniPlayerWindow = null
  })

  // State push: main window → main process → mini player window
  ipcMain.on('miniplayer:sync-state', (_e, state: unknown) => {
    if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
      miniPlayerWindow.webContents.send('miniplayer:state', state)
    }
  })

  // Commands: mini player window → main process → main window
  ipcMain.handle('miniplayer:command', (_e, cmd: { type: string; payload?: unknown }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('miniplayer:execute', cmd)
    }
  })

  // Bug report — POST to Formspree from main process (no CORS restrictions in Node.js)
  ipcMain.handle('feedback:submit', async (_e, payload: { email: string; message: string; version: string }) => {
    return new Promise<{ ok: boolean }>((resolve) => {
      try {
        const body = JSON.stringify({
          email: payload.email || 'anonymous',
          message: payload.message,
          _subject: `[Z Phase v${payload.version}] Bug Report`,
          app_version: payload.version,
        })
        const https = require('https') as typeof import('https')
        const req = https.request(
          {
            hostname: 'formspree.io',
            path: '/f/xzezrzrw',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (res) => {
            let data = ''
            res.on('data', (chunk) => { data += chunk })
            res.on('end', () => {
              try {
                const json = JSON.parse(data)
                resolve({ ok: json.ok === true || res.statusCode === 200 })
              } catch {
                resolve({ ok: res.statusCode === 200 })
              }
            })
          }
        )
        req.on('error', () => resolve({ ok: false }))
        req.write(body)
        req.end()
      } catch {
        resolve({ ok: false })
      }
    })
  })

  createWindow()
  registerUpdaterHandlers(mainWindow)

  // Subtle background update check after app startup
  setTimeout(() => {
    checkForUpdatesQuietly()
  }, 6000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
