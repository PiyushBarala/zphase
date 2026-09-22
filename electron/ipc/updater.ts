import { app, ipcMain, BrowserWindow, shell } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import http from 'node:http'
import https from 'node:https'
import * as fs from 'node:fs'
import * as path from 'node:path'

let mainWindowRef: BrowserWindow | null = null
let skippedVersion: string | null = null
let downloadedFilePath: string | null = null

export type UpdateStatusType =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatusData {
  type: UpdateStatusType
  currentVersion: string
  version?: string
  percent?: number
  bytesPerSecond?: number
  transferred?: number
  total?: number
  releaseNotes?: string
  downloadUrl?: string
  releasePageUrl?: string
  error?: string
  message?: string
}

let lastStatus: UpdateStatusData = {
  type: 'idle',
  currentVersion: app.getVersion(),
}

function sendStatus(data: UpdateStatusData) {
  lastStatus = data
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('updater:status', data)
  }
}

function compareVersions(v1: string, v2: string): number {
  const p1 = v1.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const p2 = v2.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0
    const num2 = p2[i] || 0
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  return 0
}

async function checkViaRedirect(isManual = false): Promise<void> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://github.com/PiyushBarala/zphase/releases/latest',
      {
        headers: {
          'User-Agent': 'ZPhase-Music-Player/' + app.getVersion(),
        },
      },
      (res) => {
        const loc = res.headers.location
        if (loc) {
          const match = loc.match(/\/tag\/(v?[0-9.]+)/i)
          if (match) {
            const remoteVer = match[1].replace(/^v/, '')
            const currentVer = app.getVersion()
            if (compareVersions(remoteVer, currentVer) > 0) {
              if (!isManual && skippedVersion === remoteVer) {
                resolve()
                return
              }
              const directExeUrl = `https://github.com/PiyushBarala/zphase/releases/download/v${remoteVer}/ZPhase-Setup-${remoteVer}.exe`
              sendStatus({
                type: 'available',
                currentVersion: currentVer,
                version: remoteVer,
                downloadUrl: directExeUrl,
                releasePageUrl: loc,
                message: `New version ${remoteVer} available.`,
              })
              resolve()
              return
            } else {
              sendStatus({
                type: 'not-available',
                currentVersion: currentVer,
                version: currentVer,
                message: `Z Phase is up to date (v${currentVer}).`,
              })
              resolve()
              return
            }
          }
        }

        sendStatus({
          type: 'not-available',
          currentVersion: app.getVersion(),
          version: app.getVersion(),
          message: `Z Phase is up to date (v${app.getVersion()}).`,
        })
        resolve()
      }
    )

    req.on('error', (err) => {
      sendStatus({
        type: 'error',
        currentVersion: app.getVersion(),
        error: err.message,
        message: 'Could not connect to update server. Check internet connection.',
      })
      resolve()
    })

    req.setTimeout(8000, () => {
      req.destroy()
      sendStatus({
        type: 'error',
        currentVersion: app.getVersion(),
        message: 'Connection timed out checking for updates.',
      })
      resolve()
    })
  })
}

async function checkGitHubReleasesDirectly(isManual = false): Promise<void> {
  return new Promise((resolve) => {
    const req = https.get(
      'https://api.github.com/repos/PiyushBarala/zphase/releases',
      {
        headers: {
          'User-Agent': 'ZPhase-Music-Player/' + app.getVersion(),
          'Accept': 'application/vnd.github.v3+json',
        },
      },
      (res) => {
        let rawData = ''
        res.on('data', (chunk) => {
          rawData += chunk
        })
        res.on('end', async () => {
          try {
            if (res.statusCode === 200) {
              const releases = JSON.parse(rawData)
              if (Array.isArray(releases) && releases.length > 0) {
                const latest = releases[0]
                const remoteTag = latest.tag_name || ''
                const remoteVer = remoteTag.replace(/^v/, '')
                const currentVer = app.getVersion()

                if (compareVersions(remoteVer, currentVer) > 0) {
                  if (!isManual && skippedVersion === remoteVer) {
                    resolve()
                    return
                  }
                  const exeAsset = latest.assets?.find(
                    (a: any) => a.name?.endsWith('.exe') && !a.name?.includes('Portable')
                  )
                  const directExeUrl =
                    exeAsset?.browser_download_url ||
                    `https://github.com/PiyushBarala/zphase/releases/download/v${remoteVer}/ZPhase-Setup-${remoteVer}.exe`

                  sendStatus({
                    type: 'available',
                    currentVersion: currentVer,
                    version: remoteVer,
                    releaseNotes: latest.body || undefined,
                    downloadUrl: directExeUrl,
                    releasePageUrl: latest.html_url,
                    message: `New version ${remoteVer} available.`,
                  })
                  resolve()
                  return
                } else {
                  sendStatus({
                    type: 'not-available',
                    currentVersion: currentVer,
                    version: currentVer,
                    message: `Z Phase is up to date (v${currentVer}).`,
                  })
                  resolve()
                  return
                }
              }
            }
          } catch (e) {
            console.error('[Updater] Fallback JSON parse error:', e)
          }

          // Fallback to release redirect check if API was rate limited or empty
          await checkViaRedirect(isManual)
          resolve()
        })
      }
    )

    req.on('error', async () => {
      await checkViaRedirect(isManual)
      resolve()
    })

    req.setTimeout(6000, async () => {
      req.destroy()
      await checkViaRedirect(isManual)
      resolve()
    })
  })
}

let isDownloading = false

async function downloadFileWithProgress(url: string, destPath: string, version: string): Promise<void> {
  if (isDownloading) {
    console.log('[Updater] Download is already in progress.')
    return
  }

  // If already completely downloaded previously
  if (fs.existsSync(destPath) && fs.statSync(destPath).size > 10 * 1024 * 1024) {
    console.log('[Updater] Installer already downloaded on disk:', destPath)
    downloadedFilePath = destPath
    sendStatus({
      type: 'downloaded',
      currentVersion: app.getVersion(),
      version,
      percent: 100,
      message: `Update v${version} ready to install.`,
    })
    return
  }

  isDownloading = true

  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const tempPath = destPath + '.download'
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath)
      } catch {}
    }

    const fileStream = fs.createWriteStream(tempPath)
    const startTime = Date.now()
    let lastTime = startTime
    let lastTransferred = 0
    let total = 0
    let transferred = 0
    let activeReq: any = null

    function cleanup() {
      isDownloading = false
      fileStream.close()
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
      } catch {}
    }

    function getWithRedirect(targetUrl: string, redirectCount = 0) {
      if (redirectCount > 6) {
        cleanup()
        reject(new Error('Too many redirects while downloading update'))
        return
      }

      const parsedUrl = new URL(targetUrl)
      const protocol = parsedUrl.protocol === 'http:' ? http : https

      activeReq = protocol.get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'ZPhase-Music-Player/' + app.getVersion(),
            'Accept': '*/*',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume() // discard response body
            const redirectUrl = new URL(res.headers.location, targetUrl).href
            getWithRedirect(redirectUrl, redirectCount + 1)
            return
          }

          if (res.statusCode !== 200) {
            res.resume()
            cleanup()
            reject(new Error(`Server responded with HTTP ${res.statusCode}`))
            return
          }

          total = parseInt(res.headers['content-length'] || '0', 10)

          res.on('data', (chunk: Buffer) => {
            transferred += chunk.length
            const now = Date.now()
            if (now - lastTime > 250) {
              const timeDiff = (now - lastTime) / 1000
              const bytesDiff = transferred - lastTransferred
              const bytesPerSecond = timeDiff > 0 ? Math.round(bytesDiff / timeDiff) : 0
              const percent = total > 0 ? Math.round((transferred / total) * 1000) / 10 : 0

              sendStatus({
                type: 'downloading',
                currentVersion: app.getVersion(),
                version,
                percent,
                transferred,
                total,
                bytesPerSecond,
                message: `Downloading update: ${percent}%`,
              })

              lastTime = now
              lastTransferred = transferred
            }
          })

          res.pipe(fileStream)

          fileStream.on('finish', () => {
            fileStream.close(() => {
              isDownloading = false
              try {
                if (fs.existsSync(destPath)) {
                  try {
                    fs.unlinkSync(destPath)
                  } catch {}
                }
                fs.renameSync(tempPath, destPath)
              } catch (renameErr) {
                console.warn('[Updater] Could not rename temp file, using tempPath:', renameErr)
              }

              downloadedFilePath = fs.existsSync(destPath) ? destPath : tempPath
              sendStatus({
                type: 'downloaded',
                currentVersion: app.getVersion(),
                version,
                percent: 100,
                transferred: total || transferred,
                total: total || transferred,
                message: `Update v${version} ready to install.`,
              })
              resolve()
            })
          })

          fileStream.on('error', (err) => {
            cleanup()
            reject(err)
          })

          res.on('error', (err) => {
            cleanup()
            reject(err)
          })
        }
      )

      activeReq.on('error', (err: any) => {
        cleanup()
        reject(err)
      })

      activeReq.setTimeout(45000, () => {
        activeReq.destroy()
        cleanup()
        reject(new Error('Download connection timed out'))
      })
    }

    getWithRedirect(url)
  })
}

export function registerUpdaterHandlers(win: BrowserWindow | null): void {
  mainWindowRef = win

  // Do NOT auto-download so user has full control to Download or Skip
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = true

  // Event: checking for update
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...')
    sendStatus({
      type: 'checking',
      currentVersion: app.getVersion(),
      message: 'Checking for updates...',
    })
  })

  // Event: update available (user prompted with Download or Skip)
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log(`[Updater] Update available: v${info.version}`)
    const releaseNotes =
      typeof info.releaseNotes === 'string'
        ? info.releaseNotes
        : Array.isArray(info.releaseNotes)
        ? info.releaseNotes.map((n) => (typeof n === 'string' ? n : n.note)).join('\n')
        : undefined

    sendStatus({
      type: 'available',
      currentVersion: app.getVersion(),
      version: info.version,
      releaseNotes,
      downloadUrl: `https://github.com/PiyushBarala/zphase/releases/download/v${info.version}/ZPhase-Setup-${info.version}.exe`,
      releasePageUrl: `https://github.com/PiyushBarala/zphase/releases/tag/v${info.version}`,
      message: `Version ${info.version} is available.`,
    })
  })

  // Event: update not available
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log(`[Updater] Up to date (v${info.version})`)
    sendStatus({
      type: 'not-available',
      currentVersion: app.getVersion(),
      version: info.version,
      message: 'Z Phase is up to date.',
    })
  })

  // Event: download progress from electron-updater
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.round(progress.percent * 10) / 10
    sendStatus({
      type: 'downloading',
      currentVersion: app.getVersion(),
      version: lastStatus.version,
      percent,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
      message: `Downloading update: ${percent}%`,
    })
  })

  // Event: update downloaded from electron-updater
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log(`[Updater] Update downloaded: v${info.version}`)
    sendStatus({
      type: 'downloaded',
      currentVersion: app.getVersion(),
      version: info.version,
      percent: 100,
      message: `Update v${info.version} ready to install.`,
    })
  })

  // Event: error
  autoUpdater.on('error', async (err: Error) => {
    console.error('[Updater] autoUpdater error:', err)
    if (lastStatus.type === 'downloading' || lastStatus.type === 'downloaded') {
      return
    }
    try {
      await checkGitHubReleasesDirectly(false)
    } catch {
      sendStatus({
        type: 'error',
        currentVersion: app.getVersion(),
        error: err.message || 'Failed to check for updates',
        message: 'Could not connect to update server. Check internet connection.',
      })
    }
  })

  // ── IPC Handlers ────────────────────────────────────────────────
  ipcMain.handle('updater:get-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('updater:get-last-status', () => {
    return lastStatus
  })

  ipcMain.handle('updater:check', async () => {
    // Manual check requested by user
    skippedVersion = null
    sendStatus({
      type: 'checking',
      currentVersion: app.getVersion(),
      message: 'Checking for updates...',
    })

    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err: any) {
      console.log('[Updater] autoUpdater.checkForUpdates threw, falling back to direct GitHub release check:', err?.message)
      await checkGitHubReleasesDirectly(true)
      return { success: true }
    }
  })

  ipcMain.handle('updater:skip', (_e, versionToSkip?: string) => {
    const skipped = versionToSkip || lastStatus.version || ''
    skippedVersion = skipped
    console.log('[Updater] User skipped update version:', skipped)
    sendStatus({
      type: 'idle',
      currentVersion: app.getVersion(),
      message: 'Update skipped.',
    })
    return { success: true }
  })

  ipcMain.handle('updater:download', async () => {
    const version = lastStatus.version || 'latest'
    const exeUrl =
      lastStatus.downloadUrl && lastStatus.downloadUrl.endsWith('.exe')
        ? lastStatus.downloadUrl
        : `https://github.com/PiyushBarala/zphase/releases/download/v${version}/ZPhase-Setup-${version}.exe`

    sendStatus({
      type: 'downloading',
      currentVersion: app.getVersion(),
      version,
      percent: 0,
      transferred: 0,
      total: lastStatus.total,
      message: `Starting download in background...`,
    })

    // Direct in-app background downloader
    try {
      const updatesDir = path.join(app.getPath('userData'), 'updates')
      const fileName = `ZPhase-Setup-${version}.exe`
      const destPath = path.join(updatesDir, fileName)

      downloadFileWithProgress(exeUrl, destPath, version).catch((dlErr) => {
        console.error('[Updater] Background download failed:', dlErr)
        sendStatus({
          type: 'error',
          currentVersion: app.getVersion(),
          error: dlErr.message,
          message: 'Download failed. Check your connection and try again.',
        })
      })
      return { success: true }
    } catch (e: any) {
      console.error('[Updater] Download initiation error:', e)
      sendStatus({
        type: 'error',
        currentVersion: app.getVersion(),
        error: e.message,
        message: 'Could not start download.',
      })
      return { success: false, error: e.message }
    }
  })

  ipcMain.handle('updater:open-url', (_e, url?: string) => {
    const target = url || lastStatus.releasePageUrl || 'https://github.com/PiyushBarala/zphase/releases/latest'
    shell.openExternal(target)
    return { success: true }
  })

  ipcMain.handle('updater:install', async () => {
    if (downloadedFilePath && fs.existsSync(downloadedFilePath)) {
      console.log('[Updater] Launching downloaded installer:', downloadedFilePath)
      const installerPath = downloadedFilePath
      await shell.openPath(installerPath)
      // Delete the installer file after launching (Windows may still use it briefly)
      setTimeout(() => {
        try {
          if (fs.existsSync(installerPath)) {
            fs.unlinkSync(installerPath)
            console.log('[Updater] Cleaned up installer:', installerPath)
          }
        } catch (e) {
          console.warn('[Updater] Could not delete installer (will retry on next launch):', e)
        }
        app.quit()
      }, 2500)
      return { success: true }
    }
    return { success: false, error: 'Installer file not found' }
  })
}

export async function checkForUpdatesQuietly(): Promise<void> {
  try {
    if (app.isPackaged) {
      await autoUpdater.checkForUpdates()
    } else {
      await checkGitHubReleasesDirectly(false)
    }
  } catch (e: any) {
    console.warn('[Updater] Background update check:', e)
    const errStr = String(e?.message || e)
    if (errStr.includes('404') || errStr.includes('latest.yml')) {
      await checkGitHubReleasesDirectly(false)
    }
  }
}

/**
 * Called on app startup to clean up any leftover installer files from previous update sessions.
 * This handles the case where deletion failed after the installer was launched.
 */
export function cleanupOldInstallers(): void {
  try {
    const updatesDir = path.join(app.getPath('userData'), 'updates')
    if (!fs.existsSync(updatesDir)) return
    const files = fs.readdirSync(updatesDir)
    for (const f of files) {
      if (f.toLowerCase().endsWith('.exe') || f.toLowerCase().endsWith('.exe.download')) {
        try {
          const filePath = path.join(updatesDir, f)
          fs.unlinkSync(filePath)
          console.log('[Updater] Cleaned up old installer on startup:', filePath)
        } catch {
          // File may still be in use; ignore
        }
      }
    }
  } catch (e) {
    console.warn('[Updater] cleanupOldInstallers error:', e)
  }
}
