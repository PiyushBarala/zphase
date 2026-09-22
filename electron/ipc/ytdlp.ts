import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import { spawn, exec, ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { scanAndIndexFile, extractMetadata, type ScannedTrack } from './scanner'
import { getAllTrackFilePaths, writeTracksToDb, addTrackToDownloadsPlaylist } from '../db/dbHandlers'

export interface YtSearchResult {
  id: string
  title: string
  uploader: string
  duration: number
  durationString: string
  thumbnail: string
  url: string
}

export interface DownloadProgress {
  videoId: string
  percent: number
  speed: string
  eta: string
  status: 'downloading' | 'converting' | 'completed' | 'error' | 'cancelled'
  filePath?: string
  error?: string
}

function getYtDlpPath(): string {
  const candidates = [
    path.join(process.resourcesPath, 'bin', 'yt-dlp.exe'),
    path.join(process.resourcesPath, 'yt-dlp.exe'),
    path.join(app.getAppPath(), 'resources', 'bin', 'yt-dlp.exe'),
    path.join(app.getPath('userData'), 'bin', 'yt-dlp.exe'),
    path.join(__dirname, '../../resources/bin/yt-dlp.exe'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c
    }
  }
  return 'yt-dlp'
}

function getFfmpegPath(): string {
  const candidates = [
    path.join(process.resourcesPath, 'bin', 'ffmpeg.exe'),
    path.join(process.resourcesPath, 'ffmpeg.exe'),
    path.join(app.getAppPath(), 'resources', 'bin', 'ffmpeg.exe'),
    path.join(app.getPath('userData'), 'bin', 'ffmpeg.exe'),
    path.join(__dirname, '../../resources/bin/ffmpeg.exe'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c
    }
  }
  return 'ffmpeg'
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * Get a lightweight preview thumbnail for fast loading and low bandwidth.
 * (Full resolution thumbnail is downloaded and embedded during actual song download).
 */
function getPreviewThumbnail(item: any, videoId: string): string {
  if (Array.isArray(item.thumbnails) && item.thumbnails.length > 0) {
    const smallThumb = item.thumbnails.find(
      (t: any) => t.width && t.width >= 160 && t.width <= 360
    ) || item.thumbnails.find(
      (t: any) => t.url && (t.url.includes('mqdefault') || t.url.includes('default') || t.url.includes('hqdefault'))
    )
    if (smallThumb?.url) {
      return smallThumb.url
    }
  }
  if (videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`
  }
  return item.thumbnails?.[0]?.url || ''
}

const activeDownloads = new Map<string, ChildProcess>()

/**
 * Serialises the "find my file" fallback directory scan so that concurrent
 * downloads don't scan the folder simultaneously and steal each other's files.
 * Only one download at a time runs the fallback scan; others queue behind it.
 */
let _scanQueueTail: Promise<void> = Promise.resolve()
function withScanQueue<T>(fn: () => Promise<T>): Promise<T> {
  const result = _scanQueueTail.then(fn)
  // The queue tail advances regardless of inner success/failure
  _scanQueueTail = result.then(() => {}, () => {})
  return result
}

export function registerYtDlpHandlers(): void {
  // ── 1. Search by name / keyword ──
  ipcMain.handle(
    'ytdlp:search',
    async (_event, query: string, offset: number = 1, limit: number = 8): Promise<YtSearchResult[]> => {
      const q = (query || '').trim()
      if (!q) return []

      const startIndex = Math.max(1, offset || 1)
      const count = Math.max(1, limit || 8)
      const endIndex = startIndex + count - 1

      const ytDlpPath = getYtDlpPath()
      console.log(`[yt-dlp search] Starting search for: "${q}" items ${startIndex}:${endIndex} using ${ytDlpPath}`)

      return new Promise((resolve) => {
        const args = [
          `ytsearch${endIndex}:${q}`,
          '--dump-json',
          '--no-download',
          '--flat-playlist',
          '--playlist-items',
          `${startIndex}:${endIndex}`
        ]

      const proc = spawn(ytDlpPath, args, {
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('error', (err) => {
        console.error('[yt-dlp search] Process error:', err)
        resolve([])
      })

      proc.on('close', (code) => {
        if (code !== 0 && stdout.trim().length === 0) {
          console.error(`[yt-dlp search] Process exited with code ${code}:`, stderr)
          resolve([])
          return
        }

        const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
        const results: YtSearchResult[] = []

        for (const line of lines) {
          try {
            const item = JSON.parse(line)
            const itemId = item.id || ''
            const thumbnail = getPreviewThumbnail(item, itemId)

            const durationSec = typeof item.duration === 'number' ? item.duration : 0
            const durationString = item.duration_string || formatDuration(durationSec)

            results.push({
              id: itemId,
              title: item.title || 'Unknown Title',
              uploader: item.uploader || item.channel || 'Unknown Artist',
              duration: durationSec,
              durationString,
              thumbnail,
              url: item.url || `https://www.youtube.com/watch?v=${itemId}`,
            })
          } catch (e) {
            console.error('[yt-dlp search] Error parsing JSON line:', e)
          }
        }

        console.log(`[yt-dlp search] Found ${results.length} result(s) for "${q}"`)
        resolve(results)
      })
    })
  })

  // ── 2. Download by video ID ──
  ipcMain.handle(
    'ytdlp:download',
    async (
      event,
      { videoId, title, targetFolder }: { videoId: string; title?: string; targetFolder?: string }
    ): Promise<{ success: boolean; filePath?: string; error?: string }> => {
      if (!videoId) return { success: false, error: 'No videoId provided' }

      if (activeDownloads.has(videoId)) {
        return { success: false, error: 'Already downloading this track' }
      }

      const ytDlpPath = getYtDlpPath()
      const ffmpegPath = getFfmpegPath()

      // Determine output directory
      let outDir = targetFolder
      if (!outDir || !fs.existsSync(outDir)) {
        try {
          outDir = app.getPath('music')
        } catch {
          outDir = path.join(app.getPath('userData'), 'downloads')
        }
      }
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true })
      }

      console.log(`[yt-dlp download] Starting download: ${videoId} (${title || 'no title'}) -> ${outDir}`)

      return new Promise((resolve) => {
        const args = [
          `https://www.youtube.com/watch?v=${videoId}`,
          '-x',
          '--audio-format', 'mp3',
          '--audio-quality', '0',
          '-o', path.join(outDir, '%(title)s.%(ext)s'),
          '--embed-thumbnail',
          '--add-metadata',
          '--ffmpeg-location', ffmpegPath,
          '--no-abort-on-error',
          '--retries', '5',
          '--fragment-retries', '5',
          '--socket-timeout', '30',
          '--print', 'after_move:filepath',
          '--newline',
          '--progress',
          '--no-quiet',
        ]

        const startTime = Date.now()
        const existingBeforeDownload = new Set<string>()
        try {
          if (fs.existsSync(outDir)) {
            fs.readdirSync(outDir).forEach((f) => existingBeforeDownload.add(f.toLowerCase()))
          }
        } catch {}

        const proc = spawn(ytDlpPath, args, {
          windowsHide: true,
        })

        activeDownloads.set(videoId, proc)

        let resolvedFilePath: string | null = null
        let stdoutBuffer = ''
        let lastError = ''

        // Send initial progress
        event.sender.send('ytdlp:progress', {
          videoId,
          percent: 0,
          speed: '',
          eta: '',
          status: 'downloading',
        })

        const AUDIO_EXTS = ['.mp3', '.m4a', '.opus', '.flac', '.wav', '.ogg', '.aac', '.webm']

        const processStdoutLine = (line: string) => {
          const trimmed = line.replace(/[\r\n]+/g, ' ').trim()
          if (!trimmed) return

          // Direct audio path after move
          if (AUDIO_EXTS.some((ext) => trimmed.toLowerCase().endsWith(ext)) && (trimmed.includes(outDir) || path.isAbsolute(trimmed))) {
            resolvedFilePath = path.normalize(trimmed)
            return
          }

          // 1. Check download progress regex
          // e.g. [download]  42.3% of 3.45MiB at 1.2MiB/s ETA 00:05
          const progressMatch = trimmed.match(
            /\[download\]\s+([0-9.]+)%(?:\s+of\s+([~0-9.]+\s*[A-Za-z]+))?(?:\s+at\s+([0-9.]+\s*[A-Za-z/]+))?(?:\s+ETA\s+([0-9:]+))?/
          )
          if (progressMatch) {
            const percent = parseFloat(progressMatch[1]) || 0
            const speed = progressMatch[3] ? progressMatch[3].trim() : ''
            const eta = progressMatch[4] ? progressMatch[4].trim() : ''
            event.sender.send('ytdlp:progress', {
              videoId,
              percent,
              speed,
              eta,
              status: 'downloading',
            })
            return
          }

          // 2. Check conversion / extraction state
          if (trimmed.includes('[ExtractAudio]') || trimmed.includes('[Merger]') || trimmed.includes('[Metadata]') || trimmed.includes('[EmbedThumbnail]')) {
            event.sender.send('ytdlp:progress', {
              videoId,
              percent: 99,
              speed: '',
              eta: '',
              status: 'converting',
            })
          }

          // 3. Detect destination file path (accept any audio file, NOT image thumbnails)
          const destAudioMatch = trimmed.match(/\[(?:ExtractAudio|download|Merger)\]\s+(?:Destination:\s+|Merging formats into\s+)"?([^"\r\n]+\.(?:mp3|m4a|opus|flac|wav|ogg|aac))"?/i)
          if (destAudioMatch) {
            resolvedFilePath = path.normalize(destAudioMatch[1].trim())
            return
          }

          const embedMatch = trimmed.match(/\[EmbedThumbnail\]\s+ffmpeg:\s+Adding thumbnail to\s+"?([^"\r\n]+\.(?:mp3|m4a|opus|flac|wav|ogg|aac))"?/i)
          if (embedMatch) {
            resolvedFilePath = path.normalize(embedMatch[1].trim())
            return
          }

          const alreadyMatch = trimmed.match(/\[download\]\s+(.+?)\s+has already been downloaded/)
          if (alreadyMatch) {
            const candidate = alreadyMatch[1].trim()
            if (AUDIO_EXTS.some((ext) => candidate.toLowerCase().endsWith(ext))) {
              resolvedFilePath = path.normalize(candidate)
            } else if (!candidate.match(/\.(webp|jpg|jpeg|png)$/i)) {
              resolvedFilePath = path.normalize(candidate.replace(/\.[^.]+$/, '.mp3'))
            }
          }
        }

        proc.stdout.on('data', (chunk: Buffer) => {
          // yt-dlp uses \r to overwrite progress lines in terminals.
          // We must split on \r FIRST (before \n) so every intermediate
          // percentage line is processed rather than being silently replaced.
          const raw = chunk.toString()
          stdoutBuffer += raw
          // Split on \r\n, standalone \r, or standalone \n
          const parts = stdoutBuffer.split(/\r\n|\r|\n/)
          stdoutBuffer = parts.pop() ?? ''
          for (const line of parts) {
            processStdoutLine(line)
          }
        })

        proc.stderr.on('data', (chunk: Buffer) => {
          lastError += chunk.toString()
        })

        proc.on('error', (err) => {
          activeDownloads.delete(videoId)
          event.sender.send('ytdlp:progress', {
            videoId,
            percent: 0,
            speed: '',
            eta: '',
            status: 'error',
            error: err.message,
          })
          resolve({ success: false, error: err.message })
        })

        proc.on('close', async (code) => {
          activeDownloads.delete(videoId)
          if (stdoutBuffer.trim()) {
            processStdoutLine(stdoutBuffer)
          }

          // 1. Locate the downloaded audio file
          let finalAudio = resolvedFilePath
          if (!finalAudio || !fs.existsSync(finalAudio)) {
            // Use the mutex queue so concurrent downloads don't scan simultaneously
            // and accidentally pick each other's just-written files.
            finalAudio = await withScanQueue(async () => {
              let found: string | null = null
              try {
                const allAudioFiles = fs.readdirSync(outDir)
                  .filter((f) => AUDIO_EXTS.some((ext) => f.toLowerCase().endsWith(ext)))
                  .map((f) => {
                    const p = path.normalize(path.join(outDir, f))
                    try {
                      const st = fs.statSync(p)
                      return { path: p, name: f, time: st.mtimeMs, size: st.size }
                    } catch {
                      return null
                    }
                  })
                  .filter((f): f is NonNullable<typeof f> => f !== null && f.size > 20000)

                // Check for brand new files created during this download session
                const brandNewFiles = allAudioFiles.filter(
                  (f) => !existingBeforeDownload.has(f.name.toLowerCase())
                )
                if (brandNewFiles.length > 0) {
                  brandNewFiles.sort((a, b) => b.time - a.time)
                  found = brandNewFiles[0].path
                }

                // If title was provided, try matching filename with full words if not yet found
                if (!found && title) {
                  const cleanTitleWords = title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2)
                  const titleMatch = allAudioFiles.find((f) => {
                    const fnLower = f.name.toLowerCase()
                    return cleanTitleWords.length > 0 && cleanTitleWords.filter((w) => fnLower.includes(w)).length >= Math.min(3, cleanTitleWords.length)
                  })
                  if (titleMatch) {
                    found = titleMatch.path
                  }
                }

                // Fallback: take the most recent audio file modified since download began
                if (!found) {
                  const recent = allAudioFiles
                    .filter((f) => f.time >= startTime - 10000)
                    .sort((a, b) => b.time - a.time)
                  if (recent.length > 0) {
                    found = recent[0].path
                  }
                }
              } catch {}
              return found
            })
          }

          const isFileValid = Boolean(finalAudio && fs.existsSync(finalAudio))

          if (code === 0 || isFileValid) {
            console.log(`[yt-dlp download] Completed. Final audio file: ${finalAudio}`)

            // Index into database immediately with sourceVideoId, and atomically
            // add to the Downloads playlist — all on the main process before
            // notifying the renderer, so there is no renderer-side race.
            if (finalAudio && fs.existsSync(finalAudio)) {
              try {
                await scanAndIndexFile(finalAudio, videoId, /* addToDownloads */ true)
              } catch (err) {
                console.error('[yt-dlp download] Failed to index downloaded file:', err)
              }
              // Also sync the folder to catch any edge cases or concurrent downloads
              syncFolderTracks(outDir).catch(console.error)
            } else {
              // Safety net: sync entire folder
              await syncFolderTracks(outDir).catch(console.error)
            }

            event.sender.send('ytdlp:progress', {
              videoId,
              percent: 100,
              speed: '',
              eta: '',
              status: 'completed',
              filePath: finalAudio || undefined,
            })

            resolve({ success: true, filePath: finalAudio || undefined })
          } else {
            console.error(`[yt-dlp download] Failed with exit code ${code}:`, lastError)

            let friendlyError = 'Download failed'
            if (/HTTP(S)?ConnectionPool|timed?\s*out|ConnectionReset|getaddrinfo|WinError|network/i.test(lastError)) {
              friendlyError = 'Network error: Connection timed out or interrupted. Click Retry to continue.'
            } else if (lastError.trim()) {
              const cleanLine = lastError
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.startsWith('ERROR:') || l.includes('Error:'))
                .pop()
              if (cleanLine) {
                friendlyError = cleanLine.replace(/^ERROR:\s*/, '')
              }
            }

            event.sender.send('ytdlp:progress', {
              videoId,
              percent: 0,
              speed: '',
              eta: '',
              status: 'error',
              error: friendlyError,
            })
            resolve({ success: false, error: friendlyError })
          }
        })
      })
    }
  )

  // ── 3. Cancel active download ──
  ipcMain.handle('ytdlp:cancel', async (event, videoId: string) => {
    const proc = activeDownloads.get(videoId)
    if (proc) {
      if (process.platform === 'win32' && proc.pid) {
        try {
          exec(`taskkill /pid ${proc.pid} /T /F`)
        } catch {}
      }
      try {
        proc.kill('SIGTERM')
      } catch {}
      activeDownloads.delete(videoId)
      event.sender.send('ytdlp:progress', {
        videoId,
        percent: 0,
        speed: '',
        eta: '',
        status: 'cancelled',
      })
      return true
    }
    return false
  })

  // ── 4. Get default music folder ──
  ipcMain.handle('ytdlp:get-default-folder', () => {
    try {
      return app.getPath('music')
    } catch {
      try {
        return app.getPath('downloads')
      } catch {
        return path.join(app.getPath('userData'), 'downloads')
      }
    }
  })

  // ── 5. Pick download folder dialog ──
  ipcMain.handle('ytdlp:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win ?? undefined as any, {
      title: 'Select Download Folder',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── 6. Get related tracks (YouTube Mix) ──
  ipcMain.handle(
    'ytdlp:getRelated',
    async (_event, videoId: string, offset: number = 1, limit: number = 20): Promise<YtSearchResult[]> => {
      const id = (videoId || '').trim()
      if (!id) return []

      const startIndex = Math.max(1, offset || 1)
      const count = Math.max(1, limit || 20)
      const endIndex = startIndex + count - 1

      const ytDlpPath = getYtDlpPath()
      console.log(`[yt-dlp related] Fetching YouTube Mix for videoId: ${id} items ${startIndex}:${endIndex} using ${ytDlpPath}`)

      return new Promise((resolve) => {
        const args = [
          `https://www.youtube.com/watch?v=${id}&list=RD${id}`,
          '--yes-playlist',
          '--flat-playlist',
          '--dump-json',
          '--no-download',
          '--playlist-items',
          `${startIndex}:${endIndex}`
        ]

      const proc = spawn(ytDlpPath, args, {
        windowsHide: true,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('error', (err) => {
        console.error('[yt-dlp related] Process error:', err)
        resolve([])
      })

      proc.on('close', (code) => {
        if (code !== 0 && stdout.trim().length === 0) {
          console.error(`[yt-dlp related] Process exited with code ${code}:`, stderr)
          resolve([])
          return
        }

        const lines = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
        const results: YtSearchResult[] = []

        for (const line of lines) {
          try {
            const item = JSON.parse(line)
            const itemId = item.id || ''

            // Skip the first entry if it duplicates the seed track
            if (itemId === id) {
              continue
            }

            const thumbnail = getPreviewThumbnail(item, itemId)

            const durationSec = typeof item.duration === 'number' ? item.duration : 0
            const durationString = item.duration_string || formatDuration(durationSec)

            results.push({
              id: itemId,
              title: item.title || 'Unknown Title',
              uploader: item.uploader || item.channel || 'Unknown Artist',
              duration: durationSec,
              durationString,
              thumbnail,
              url: item.url || `https://www.youtube.com/watch?v=${itemId}`,
            })
          } catch (e) {
            console.error('[yt-dlp related] Error parsing JSON line:', e)
          }
        }

        console.log(`[yt-dlp related] Found ${results.length} related tracks for seed "${id}"`)
        resolve(results)
      })
    })
  })

  // ── 6. Sync entire folder (ensures all downloaded MP3s in directory are indexed) ──
  ipcMain.handle('ytdlp:sync-folder', async (_event, folderPath?: string) => {
    return syncFolderTracks(folderPath)
  })
}

/**
 * Fast batch sync of a music / download directory with lokal.db.
 * Compares files against existing database tracks, parses metadata only for missing tracks,
 * writes them in a single batch, adds them to the Downloads playlist, and notifies all windows.
 */
export async function syncFolderTracks(folderPath?: string): Promise<{ synced: number; error?: string }> {
  let outDir = folderPath
  if (!outDir || !fs.existsSync(outDir)) {
    try {
      outDir = app.getPath('music')
    } catch {
      outDir = path.join(app.getPath('userData'), 'downloads')
    }
  }
  if (!fs.existsSync(outDir)) return { synced: 0 }

  try {
    const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.opus', '.flac', '.wav', '.ogg', '.aac', '.webm'])
    const allAudioFiles: string[] = []

    const walk = (dir: string) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(full)
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase()
            if (AUDIO_EXTS.has(ext)) {
              allAudioFiles.push(path.normalize(full))
            }
          }
        }
      } catch {}
    }

    walk(outDir)

    const existingPaths = getAllTrackFilePaths()
    const missingFiles = allAudioFiles.filter((f) => !existingPaths.has(f.toLowerCase()))

    if (missingFiles.length === 0) {
      return { synced: 0 }
    }

    console.log(`[syncFolderTracks] Found ${missingFiles.length} missing tracks in ${outDir}. Indexing into library...`)
    const scannedTracks: (ScannedTrack & { artworkData: Buffer | null })[] = []

    for (const f of missingFiles) {
      try {
        const track = await extractMetadata(f)
        scannedTracks.push(track as (ScannedTrack & { artworkData: Buffer | null }))
      } catch (err) {
        console.error(`[syncFolderTracks] Error extracting metadata for ${f}:`, err)
      }
    }

    if (scannedTracks.length > 0) {
      writeTracksToDb(scannedTracks)
      console.log(`[syncFolderTracks] Successfully indexed ${scannedTracks.length} tracks into DB`)

      // Add each newly-indexed track to the Downloads playlist
      try {
        const { getDb } = await import('../db/database')
        const db = getDb()
        for (const t of scannedTracks) {
          const normPath = path.normalize(t.filePath)
          const stmt = db.prepare('SELECT id FROM tracks WHERE file_path = ?')
          stmt.bind([normPath])
          if (stmt.step()) {
            const row = stmt.getAsObject() as Record<string, unknown>
            const trackId = row.id as number
            if (trackId) {
              addTrackToDownloadsPlaylist(trackId)
            }
          }
          stmt.free()
        }
        console.log(`[syncFolderTracks] Added ${scannedTracks.length} tracks to Downloads playlist`)
      } catch (plErr) {
        console.error('[syncFolderTracks] Failed to add tracks to Downloads playlist:', plErr)
      }

      // Broadcast update to all windows
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('library:tracks-updated')
        }
      }
    }

    return { synced: scannedTracks.length }
  } catch (err: any) {
    console.error('[syncFolderTracks] Error:', err)
    return { synced: 0, error: err.message }
  }
}

