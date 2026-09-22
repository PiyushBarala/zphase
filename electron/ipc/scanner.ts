import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import { promises as fsp } from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { writeTracksToDb, addTrackToDownloadsPlaylist } from '../db/dbHandlers'

// music-metadata is ESM-only (v9+). In an electron-vite CJS bundle,
// static `import * as mm` produces a broken namespace. Dynamic import()
// is the correct solution — Node.js resolves it as a true ESM module at runtime.
type MusicMetadata = typeof import('music-metadata')
let _mm: MusicMetadata | null = null
async function getMm(): Promise<MusicMetadata> {
  if (!_mm) _mm = await import('music-metadata')
  return _mm
}

// Audio extensions we care about
const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.aac', '.opus'])

export interface ScannedTrack {
  filePath: string
  fileHash: string
  title: string
  artist: string
  albumArtist: string
  album: string
  year: number | null
  trackNumber: number | null
  discNumber: number | null
  duration: number // seconds
  bitrate: number | null
  sampleRate: number | null
  hasArtwork: boolean
  artworkData: Buffer | null // raw image bytes
  artworkMime: string | null
  genre: string | null
  comment: string | null
  sourceVideoId?: string | null
}

/**
 * Recursively walk a directory and return all audio file paths.
 */
async function walkDir(dir: string, found: string[] = []): Promise<string[]> {
  let entries: import('fs').Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    // skip unreadable directories
    return found
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkDir(fullPath, found)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (AUDIO_EXTENSIONS.has(ext)) {
        found.push(fullPath)
      }
    }
  }
  return found
}

/**
 * Compute a short hash of a file path (used as a stable identifier before DB).
 */
function hashFilePath(filePath: string): string {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16)
}

/**
 * Clean a raw filename into a human-readable string.
 * Handles patterns like:
 *   "TAKEOVER_-_AP_DHILLON_(256k)" → "TAKEOVER - AP DHILLON"
 *   "Truck (Official Video) | Khasa Aal" → "Truck | Khasa Aal"
 */
function cleanName(raw: string): string {
  let s = raw
    .replace(/_/g, ' ')   // underscores → spaces

  // ── Strip bracketed/parenthesized junk ──────────────────────
  // e.g. (256k), [Official Video], (Lyric Video)
  s = s.replace(/\s*[\[(][^\]\)]{0,80}[\])]\s*/g, ' ')

  // ── Strip bare descriptor phrases (word-boundary aware) ──────
  const STRIP: RegExp[] = [
    // "Official Video / Audio / Music Video / Song" in any order
    /\bOfficial\s+Music\s+Video\b/gi,
    /\bOfficial\s+(?:Video|Audio|Song)\b/gi,
    /\bOfficial\b/gi,
    // "Full Video / Song / Audio / HD"
    /\bFull\s+(?:Video|Song|Audio|HD)\b/gi,
    // "Lyric Video", "Lyrics Video", "Lyrical"
    /\bLyric(?:al|s)?\s+Video\b/gi,
    // "Music Video"
    /\bMusic\s+Video\b/gi,
    // "Slowed & Reverb", "Over Slowed", "Slowed Reverb", "Slowed", "Reverb"
    /\bOver\s+Slowed\b/gi,
    /\bSlowed\s*[+&]?\s*Reverb\b/gi,
    /\bSlowed\b/gi,
    /\bReverb\b/gi,
    // "HD Video", "HQ", "4K", "4K Video"
    /\b4K\s*(?:Video)?\b/gi,
    /\b(?:HD|HQ)\s*(?:Video)?\b/gi,
    // "WhatsApp Status Video"
    /\bWhatsApp\s*Status(?:\s*Video)?\b/gi,
    // Regional genre tags  e.g. "New Haryanvi Songs 2025", "Haryanvi Song"
    /\bNew\s+(?:Haryanvi|Punjabi|Hindi|Rajasthani|Bhojpuri|Marwadi|Marathi|Bengali|Tamil|Telugu)\s+Songs?\b/gi,
    /\b(?:Haryanvi|Punjabi|Hindi|Rajasthani|Bhojpuri|Marwadi|Marathi|Bengali|Tamil|Telugu)\s+Songs?\b/gi,
    // Standalone year (2000-2099)
    /\b20\d{2}\b/g,
    // Hashtags (ASCII and Devanagari)
    /#[\w\u0900-\u097F]+/g,
    // " - Copy" / "- Copy (2)" suffixes from Windows duplicates
    /\s*-\s*Copy(?:\s*\(\d+\))?\b/gi,
    // Pipe characters used as separators
    /\|/g,
  ]

  for (const re of STRIP) {
    s = s.replace(re, ' ')
  }

  return s
    .replace(/\s{2,}/g, ' ')   // collapse runs of spaces
    .replace(/^\s*[-–,]+\s*/, '') // leading dashes/commas
    .replace(/\s*[-–,]+\s*$/, '') // trailing dashes/commas
    .trim()
}

/**
 * Try to extract author (artist) and song title from a string.
 * Used ONLY when the audio file metadata has no existing author name.
 * Supports patterns:
 *   "Artist - Title"
 *   "Artist – Title"
 *   "Artist | Title" / "Title | Artist"
 *   "Title by Artist"
 */
function extractAuthorAndTitle(raw: string): { title: string; artist: string | null } {
  let s = raw.replace(/_/g, ' ')

  // Strip bracketed descriptors like (Official Video), [256k], etc.
  s = s.replace(/\s*[\[(][^\]\)]{0,80}[\])]\s*/g, ' ')

  // 1. "Artist - Title" or "Artist – Title" or "Artist — Title"
  const dashMatch = s.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  if (dashMatch) {
    const part1 = cleanName(dashMatch[1])
    const part2 = cleanName(dashMatch[2])
    if (part1 && part2) {
      return { artist: part1, title: part2 }
    }
  }

  // 2. "Title | Artist" or "Artist | Title"
  const pipeMatch = s.match(/^(.+?)\s*\|\s*(.+)$/)
  if (pipeMatch) {
    const left = cleanName(pipeMatch[1])
    const right = cleanName(pipeMatch[2])
    if (left && right) {
      return { artist: right, title: left }
    }
  }

  // 3. "Title by Artist"
  const byMatch = s.match(/^(.+?)\s+by\s+(.+)$/i)
  if (byMatch) {
    const left = cleanName(byMatch[1])
    const right = cleanName(byMatch[2])
    if (left && right) {
      return { artist: right, title: left }
    }
  }

  return { title: cleanName(s), artist: null }
}

/**
 * Extract metadata from a single audio file.
 */
export async function extractMetadata(filePath: string): Promise<ScannedTrack> {
  const filenameBase = path.basename(filePath, path.extname(filePath))
  let meta: import('music-metadata').IAudioMetadata

  try {
    const mm = await getMm()
    meta = await mm.parseFile(filePath, { skipCovers: false })
  } catch (err) {
    // Log the real error so we can diagnose why mm.parseFile is failing
    console.error(`[Scanner] mm.parseFile failed for: ${filePath}`, err)

    // Author is empty, so extract author and title from filename
    const extracted = extractAuthorAndTitle(filenameBase)
    return {
      filePath,
      fileHash: hashFilePath(filePath),
      title: extracted.title || cleanName(filenameBase),
      artist: extracted.artist ?? 'Unknown Artist',
      albumArtist: extracted.artist ?? 'Unknown Artist',
      album: 'Unknown Album',
      year: null,
      trackNumber: null,
      discNumber: null,
      duration: 0,
      bitrate: null,
      sampleRate: null,
      hasArtwork: false,
      artworkData: null,
      artworkMime: null,
      genre: null,
      comment: null
    }
  }

  const t = meta.common
  const f = meta.format

  // Extract embedded artwork
  const picture = t.picture?.[0] ?? null
  const artworkData = picture ? Buffer.from(picture.data) : null
  const artworkMime = picture?.format ?? null

  // Check if the song already has an author name in its metadata
  const rawArtist = t.artist?.trim() || t.albumartist?.trim() || ''
  const hasExistingAuthor = rawArtist.length > 0 && rawArtist.toLowerCase() !== 'unknown artist'

  let title = ''
  let artist = ''
  let albumArtist = ''

  if (hasExistingAuthor) {
    // If the song already has an author name, DO NOT extract author from the title!
    artist = rawArtist
    albumArtist = t.albumartist?.trim() || rawArtist
    title = t.title?.trim() || cleanName(filenameBase)
  } else {
    // Author name is empty: extract author and title from the song title / filename
    const candidate = t.title?.trim() || filenameBase
    const extracted = extractAuthorAndTitle(candidate)
    title = extracted.title || cleanName(candidate)
    artist = extracted.artist || 'Unknown Artist'
    albumArtist = extracted.artist || 'Unknown Artist'
  }

  const album = t.album?.trim() || 'Unknown Album'

  return {
    filePath,
    fileHash: hashFilePath(filePath),
    title,
    artist,
    albumArtist,
    album,
    year: t.year ?? null,
    trackNumber: t.track?.no ?? null,
    discNumber: t.disk?.no ?? null,
    duration: f.duration ?? 0,
    bitrate: f.bitrate ? Math.round(f.bitrate / 1000) : null,
    sampleRate: f.sampleRate ?? null,
    hasArtwork: artworkData !== null,
    artworkData,
    artworkMime,
    genre: t.genre?.[0]?.trim() ?? null,
    comment: Array.isArray(t.comment)
      ? (t.comment as Array<{ text?: string } | string>)
        .map((c) => (typeof c === 'string' ? c : c.text ?? ''))
        .filter(Boolean)
        .join('; ')
      : null
  }
}

/**
 * Register all library-related IPC handlers.
 * Call this once from main.ts after the app is ready.
 */
export function registerScannerHandlers(): void {
  // Handler: open native folder picker
  ipcMain.handle('library:pick-folder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: 'Select your music folder',
      properties: ['openDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Handler: scan a folder and return all scanned tracks
  ipcMain.handle('library:scan', async (event, folderPath: string) => {
    console.log(`[Scanner] Starting scan of: ${folderPath}`)

    // Step 1 – collect all audio file paths
    const allFiles = await walkDir(folderPath)
    const total = allFiles.length
    console.log(`[Scanner] Found ${total} audio file(s)`)

    if (total === 0) return []

    const tracks: ScannedTrack[] = []

    for (let i = 0; i < allFiles.length; i++) {
      const filePath = allFiles[i]

      // Report progress to renderer
      event.sender.send('library:scan-progress', {
        current: i + 1,
        total,
        file: path.basename(filePath)
      })

      try {
        const track = await extractMetadata(filePath)
        tracks.push(track)
        console.log(`[Scanner] (${i + 1}/${total}) ${track.artist} – ${track.title}`)
      } catch (err) {
        console.error(`[Scanner] Failed to read: ${filePath}`, err)
      }
    }

    console.log(`[Scanner] Scan complete. ${tracks.length} tracks extracted.`)

    // Persist to SQLite (with artwork buffers intact)
    writeTracksToDb(tracks as (ScannedTrack & { artworkData: Buffer | null })[])

    // Return tracks without raw artwork data (too large for IPC)
    // Artwork will be served separately via file:// URLs
    return tracks.map((t) => ({
      ...t,
      artworkData: null // strip binary before sending over IPC
    }))
  })

  // Handler: scan and index a single audio file
  ipcMain.handle('library:scan-file', async (_event, filePath: string) => {
    return scanAndIndexFile(filePath)
  })
}

/**
 * Scan a single audio file, write its metadata to SQLite DB, and return the scanned track.
 * @param addToDownloadsPlaylist - when true, atomically adds the track to the Downloads playlist
 */
export async function scanAndIndexFile(
  filePath: string,
  sourceVideoId?: string | null,
  addToDownloads: boolean = false
): Promise<ScannedTrack | null> {
  const normalizedPath = path.normalize(filePath)
  // Retry up to 3 times with backoff in case Windows file handle (e.g. from ffmpeg) is still releasing
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (!fs.existsSync(normalizedPath)) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 250 * attempt))
          continue
        }
        return null
      }
      const track = await extractMetadata(normalizedPath)
      if (sourceVideoId) {
        track.sourceVideoId = sourceVideoId
      }
      const newRows = writeTracksToDb([track as (ScannedTrack & { artworkData: Buffer | null })])
      console.log(`[Scanner] Indexed single file: ${track.artist} – ${track.title}${sourceVideoId ? ` (source: ${sourceVideoId})` : ''}`)

      if (addToDownloads) {
        // Resolve the track's DB id — look it up by normalized file path
        try {
          const { getDb } = await import('../db/database')
          const db = getDb()
          const stmt = db.prepare('SELECT id FROM tracks WHERE file_path = ?')
          stmt.bind([normalizedPath])
          let trackId: number | null = null
          if (stmt.step()) {
            const row = stmt.getAsObject() as Record<string, unknown>
            trackId = row.id as number
          }
          stmt.free()
          if (trackId) {
            addTrackToDownloadsPlaylist(trackId)
            console.log(`[Scanner] Added track id=${trackId} to Downloads playlist`)
          }
        } catch (plErr) {
          console.error('[Scanner] Failed to add track to Downloads playlist:', plErr)
        }
      }

      return {
        ...track,
        artworkData: null
      }
    } catch (err) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 250 * attempt))
        continue
      }
      console.error(`[Scanner] Failed to index single file after 3 attempts: ${filePath}`, err)
      return null
    }
  }
  return null
}

