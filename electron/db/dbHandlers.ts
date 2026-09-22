import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getDb, persistDb, getArtworkDir } from '../db/database'
import type { ScannedTrack } from '../ipc/scanner'
import type { Track, Album, Artist, Playlist } from '../../src/types'

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

function rowToTrack(row: Record<string, unknown>): Track {
  return {
    id:            row.id as number,
    filePath:      row.file_path as string,
    fileHash:      row.file_hash as string,
    title:         row.title as string,
    artist:        (row.artist_name as string) || 'Unknown Artist',
    albumArtist:   row.album_artist as string,
    album:         (row.album_name as string) || 'Unknown Album',
    year:          row.year as number | null,
    trackNumber:   row.track_number as number | null,
    discNumber:    row.disc_number as number | null,
    duration:      row.duration as number,
    bitrate:       row.bitrate as number | null,
    sampleRate:    row.sample_rate as number | null,
    hasArtwork:    Boolean(row.has_artwork),
    artworkPath:   row.artwork_path as string | null,
    genre:         row.genre as string | null,
    comment:       row.comment as string | null,
    liked:         Boolean(row.liked),
    playCount:     row.play_count as number,
    lastPlayedAt:  row.last_played_at as string | null,
    dateAdded:     row.date_added as string,
    sourceVideoId: (row.source_video_id as string) || null
  }
}

function execRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const db = getDb()
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows: Record<string, unknown>[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>)
  stmt.free()
  return rows
}

/** Get a Set of all normalized, lowercase file paths currently in the tracks table. */
export function getAllTrackFilePaths(): Set<string> {
  const rows = execRows('SELECT file_path FROM tracks')
  const set = new Set<string>()
  for (const r of rows) {
    if (r.file_path) {
      set.add(path.normalize(r.file_path as string).toLowerCase())
    }
  }
  return set
}

/** Save artwork buffer to disk and return the file path. */
function saveArtwork(fileHash: string, data: Buffer, mime: string): string {
  const ext = mime.includes('png') ? 'png' : mime.includes('gif') ? 'gif' : 'jpg'
  const artPath = path.join(getArtworkDir(), `${fileHash}.${ext}`)
  if (!fs.existsSync(artPath)) {
    fs.writeFileSync(artPath, data)
  }
  return artPath
}

/** Insert or get artist id. */
function upsertArtist(name: string): number {
  const db = getDb()
  db.run('INSERT OR IGNORE INTO artists (name) VALUES (?)', [name])
  const rows = execRows('SELECT id FROM artists WHERE name = ? COLLATE NOCASE', [name])
  return rows[0].id as number
}

/** Insert or get album id. */
function upsertAlbum(
  name: string,
  albumArtist: string,
  artistId: number,
  year: number | null,
  artworkPath: string | null
): number {
  const db = getDb()
  db.run(
    `INSERT OR IGNORE INTO albums (name, album_artist, artist_id, year, artwork_path)
     VALUES (?, ?, ?, ?, ?)`,
    [name, albumArtist, artistId, year, artworkPath]
  )
  // Update artwork if we now have one and didn't before
  if (artworkPath) {
    db.run(
      `UPDATE albums SET artwork_path = ? WHERE name = ? AND album_artist = ? AND artwork_path IS NULL`,
      [artworkPath, name, albumArtist]
    )
  }
  const rows = execRows(
    'SELECT id FROM albums WHERE name = ? AND album_artist = ? COLLATE NOCASE',
    [name, albumArtist]
  )
  return rows[0].id as number
}

// ────────────────────────────────────────────────────────────
// Public: write scanned tracks to DB
// ────────────────────────────────────────────────────────────

export function writeTracksToDb(scannedTracks: (ScannedTrack & { artworkData: Buffer | null })[]): number {
  const db = getDb()
  let inserted = 0

  for (const t of scannedTracks) {
    const normPath = path.normalize(t.filePath)
    // If already in DB, update title, artist, and metadata
    const existing = execRows('SELECT id, artwork_path FROM tracks WHERE file_path = ? OR file_path = ?', [normPath, t.filePath])
    if (existing.length > 0) {
      const existingId = existing[0].id as number
      let artworkPath = (existing[0].artwork_path as string) || null
      if (!artworkPath && t.artworkData && t.artworkMime) {
        try {
          artworkPath = saveArtwork(t.fileHash, t.artworkData, t.artworkMime)
        } catch { /* ignore */ }
      }
      const artistId = upsertArtist(t.artist)
      const albumArtistId = upsertArtist(t.albumArtist)
      const albumId = upsertAlbum(t.album, t.albumArtist, albumArtistId, t.year, artworkPath)
      db.run(
        `UPDATE tracks SET
           file_path = ?,
           title = ?,
           artist_id = ?,
           album_id = ?,
           album_artist = ?,
           has_artwork = CASE WHEN ? IS NOT NULL THEN 1 ELSE has_artwork END,
           artwork_path = COALESCE(?, artwork_path),
           source_video_id = COALESCE(?, source_video_id)
         WHERE id = ?`,
        [normPath, t.title, artistId, albumId, t.albumArtist, artworkPath, artworkPath, t.sourceVideoId || null, existingId]
      )
      continue
    }

    // Save artwork
    let artworkPath: string | null = null
    if (t.artworkData && t.artworkMime) {
      try {
        artworkPath = saveArtwork(t.fileHash, t.artworkData, t.artworkMime)
      } catch { /* ignore artwork errors */ }
    }

    const artistId = upsertArtist(t.artist)
    const albumArtistId = upsertArtist(t.albumArtist)
    const albumId = upsertAlbum(t.album, t.albumArtist, albumArtistId, t.year, artworkPath)

    db.run(
      `INSERT OR IGNORE INTO tracks
        (file_path, file_hash, title, artist_id, album_id, album_artist,
         year, track_number, disc_number, duration, bitrate, sample_rate,
         has_artwork, artwork_path, genre, comment, source_video_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normPath, t.fileHash, t.title, artistId, albumId, t.albumArtist,
        t.year, t.trackNumber, t.discNumber, t.duration, t.bitrate, t.sampleRate,
        t.hasArtwork ? 1 : 0, artworkPath, t.genre, t.comment, t.sourceVideoId || null
      ]
    )
    inserted++
  }

  persistDb()
  console.log(`[DB] Inserted ${inserted} new tracks`)
  return inserted
}

// ────────────────────────────────────────────────────────────
// Public: add a track to the Downloads playlist atomically
// ────────────────────────────────────────────────────────────

/**
 * Insert a track into the Downloads playlist (id = 2) using INSERT OR IGNORE
 * so concurrent calls are safe and idempotent.
 * Returns the track id on success, or null if the track wasn't found.
 */
export function addTrackToDownloadsPlaylist(trackId: number): boolean {
  const db = getDb()
  const pos = execRows(
    'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = 2'
  )[0].next as number
  db.run(
    'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (2, ?, ?)',
    [trackId, pos]
  )
  persistDb()
  return true
}

// ────────────────────────────────────────────────────────────
// IPC handlers
// ────────────────────────────────────────────────────────────

const TRACKS_SQL = `
  SELECT t.*, ar.name AS artist_name, al.name AS album_name
  FROM tracks t
  LEFT JOIN artists ar ON ar.id = t.artist_id
  LEFT JOIN albums  al ON al.id = t.album_id
`

export function registerDbHandlers(): void {

  ipcMain.handle('db:add-track-to-downloads-playlist', (_e, trackId: number) => {
    return addTrackToDownloadsPlaylist(trackId)
  })

  ipcMain.handle('db:get-tracks', () => {
    const rows = execRows(`${TRACKS_SQL} ORDER BY ar.name COLLATE NOCASE, al.name COLLATE NOCASE, t.disc_number, t.track_number`)
    return rows.map(rowToTrack)
  })

  ipcMain.handle('db:get-albums', () => {
    return execRows(`
      SELECT al.*, ar.name AS artist_name,
             COUNT(t.id) AS track_count
      FROM albums al
      LEFT JOIN artists ar ON ar.id = al.artist_id
      LEFT JOIN tracks  t  ON t.album_id = al.id
      GROUP BY al.id
      ORDER BY al.name COLLATE NOCASE
    `).map((r) => ({
      id:          r.id,
      name:        r.name,
      artist:      r.artist_name || r.album_artist,
      albumArtist: r.album_artist,
      year:        r.year,
      artworkPath: r.artwork_path,
      trackCount:  r.track_count
    } as Album))
  })

  ipcMain.handle('db:get-artists', () => {
    return execRows(`
      SELECT ar.*, COUNT(t.id) AS track_count
      FROM artists ar
      LEFT JOIN tracks t ON t.artist_id = ar.id
      GROUP BY ar.id
      ORDER BY ar.name COLLATE NOCASE
    `).map((r) => ({ id: r.id, name: r.name, trackCount: r.track_count } as Artist))
  })

  ipcMain.handle('db:get-album-tracks', (_e, albumId: number) => {
    const rows = execRows(
      `${TRACKS_SQL} WHERE t.album_id = ? ORDER BY t.disc_number, t.track_number`,
      [albumId]
    )
    return rows.map(rowToTrack)
  })

  ipcMain.handle('db:get-artist-tracks', (_e, artistId: number) => {
    const rows = execRows(
      `${TRACKS_SQL} WHERE t.artist_id = ? ORDER BY al.name COLLATE NOCASE, t.disc_number, t.track_number`,
      [artistId]
    )
    return rows.map(rowToTrack)
  })

  ipcMain.handle('db:search-tracks', (_e, query: string) => {
    const like = `%${query.replace(/%/g, '\\%')}%`
    const rows = execRows(
      `${TRACKS_SQL}
       WHERE t.title LIKE ? ESCAPE '\\'
          OR ar.name LIKE ? ESCAPE '\\'
          OR al.name LIKE ? ESCAPE '\\'
       ORDER BY t.title COLLATE NOCASE
       LIMIT 100`,
      [like, like, like]
    )
    return rows.map(rowToTrack)
  })

  // ── Playlists ──────────────────────────────────────────────

  ipcMain.handle('db:get-playlists', () => {
    return execRows(`
      SELECT p.*,
        (SELECT t.artwork_path
         FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = p.id AND t.artwork_path IS NOT NULL AND t.artwork_path != ''
         ORDER BY pt.position
         LIMIT 1) AS artwork_path,
        (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
      FROM playlists p ORDER BY p.id
    `).map((r) => ({
      id: r.id,
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      artworkPath: (r.artwork_path as string) || null,
      trackCount: (r.track_count as number) || 0
    } as Playlist))
  })

  ipcMain.handle('db:create-playlist', (_e, name: string) => {
    const db = getDb()
    db.run('INSERT INTO playlists (name) VALUES (?)', [name])
    const rows = execRows('SELECT * FROM playlists WHERE id = last_insert_rowid()')
    persistDb()
    return rows[0]
  })

  ipcMain.handle('db:rename-playlist', (_e, id: number, name: string) => {
    getDb().run("UPDATE playlists SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, id])
    persistDb()
  })

  ipcMain.handle('db:delete-playlist', (_e, id: number) => {
    if (id === 1) return // protect Liked Songs
    getDb().run('DELETE FROM playlists WHERE id = ?', [id])
    persistDb()
  })

  ipcMain.handle('db:get-playlist-tracks', (_e, playlistId: number) => {
    const rows = execRows(
      `${TRACKS_SQL}
       JOIN playlist_tracks pt ON pt.track_id = t.id
       WHERE pt.playlist_id = ?
       ORDER BY pt.position`,
      [playlistId]
    )
    return rows.map(rowToTrack)
  })

  ipcMain.handle('db:add-track-to-playlist', (_e, playlistId: number, trackId: number) => {
    const db = getDb()
    const pos = execRows(
      'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = ?',
      [playlistId]
    )[0].next as number
    db.run(
      'INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?, ?, ?)',
      [playlistId, trackId, pos]
    )
    persistDb()
  })

  ipcMain.handle('db:remove-track-from-playlist', (_e, playlistId: number, trackId: number) => {
    getDb().run(
      'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
      [playlistId, trackId]
    )
    persistDb()
  })

  ipcMain.handle('db:reorder-playlist-track', (_e, playlistId: number, trackId: number, newPos: number) => {
    getDb().run(
      'UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?',
      [newPos, playlistId, trackId]
    )
    persistDb()
  })

  ipcMain.handle('db:get-track-playlists', (_e, trackId: number) => {
    return execRows(
      'SELECT playlist_id FROM playlist_tracks WHERE track_id = ?',
      [trackId]
    ).map((r) => r.playlist_id as number)
  })

  // ── Liked songs ────────────────────────────────────────────

  ipcMain.handle('db:toggle-like', (_e, trackId: number) => {
    const db = getDb()
    const rows = execRows('SELECT liked FROM tracks WHERE id = ?', [trackId])
    if (rows.length === 0) return false
    const newLiked = rows[0].liked ? 0 : 1
    db.run('UPDATE tracks SET liked = ? WHERE id = ?', [newLiked, trackId])
    // Add/remove from Liked Songs playlist (id=1)
    if (newLiked) {
      const pos = execRows(
        'SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_tracks WHERE playlist_id = 1'
      )[0].next as number
      db.run('INSERT OR IGNORE INTO playlist_tracks VALUES (1, ?, ?)', [trackId, pos])
    } else {
      db.run('DELETE FROM playlist_tracks WHERE playlist_id = 1 AND track_id = ?', [trackId])
    }
    persistDb()
    return Boolean(newLiked)
  })

  ipcMain.handle('db:get-liked-tracks', () => {
    const rows = execRows(
      `${TRACKS_SQL} WHERE t.liked = 1 ORDER BY t.title COLLATE NOCASE`
    )
    return rows.map(rowToTrack)
  })

  // ── Play history ───────────────────────────────────────────

  ipcMain.handle('db:record-play', (_e, trackId: number) => {
    const db = getDb()
    db.run("INSERT INTO play_history (track_id) VALUES (?)", [trackId])
    db.run("UPDATE tracks SET play_count = play_count + 1, last_played_at = datetime('now') WHERE id = ?", [trackId])
    // Keep history to last 500 entries
    db.run("DELETE FROM play_history WHERE id NOT IN (SELECT id FROM play_history ORDER BY id DESC LIMIT 500)")
    persistDb()
  })

  ipcMain.handle('db:get-recently-played', (_e, limit = 20) => {
    const rows = execRows(
      `${TRACKS_SQL}
       JOIN (
         SELECT DISTINCT track_id, MAX(played_at) AS last_played
         FROM play_history GROUP BY track_id
       ) ph ON ph.track_id = t.id
       ORDER BY ph.last_played DESC
       LIMIT ?`,
      [limit]
    )
    return rows.map(rowToTrack)
  })

  // ── Settings ───────────────────────────────────────────────

  ipcMain.handle('settings:get', (_e, key: string) => {
    const rows = execRows('SELECT value FROM settings WHERE key = ?', [key])
    if (rows.length === 0) return null
    try { return JSON.parse(rows[0].value as string) } catch { return rows[0].value }
  })

  ipcMain.handle('settings:set', (_e, key: string, value: unknown) => {
    getDb().run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    )
    persistDb()
  })

  // ── Track metadata editing ─────────────────────────────────

  ipcMain.handle('db:update-track', (_e, trackId: number, updates: {
    title?: string
    artist?: string
    albumArtist?: string
    album?: string
    year?: number | null
    genre?: string | null
  }) => {
    const db = getDb()

    // Upsert artist if changed
    if (updates.artist) {
      db.run('INSERT OR IGNORE INTO artists (name) VALUES (?)', [updates.artist])
      const artistRows = execRows('SELECT id FROM artists WHERE name = ? COLLATE NOCASE', [updates.artist])
      if (artistRows.length > 0) {
        db.run('UPDATE tracks SET artist_id = ? WHERE id = ?', [artistRows[0].id, trackId])
      }
    }

    // Upsert album if changed
    if (updates.album) {
      const albumArtist = updates.albumArtist ?? updates.artist ?? 'Unknown Artist'
      db.run(
        'INSERT OR IGNORE INTO albums (name, album_artist) VALUES (?, ?)',
        [updates.album, albumArtist]
      )
      const albumRows = execRows(
        'SELECT id FROM albums WHERE name = ? AND album_artist = ? COLLATE NOCASE',
        [updates.album, albumArtist]
      )
      if (albumRows.length > 0) {
        db.run('UPDATE tracks SET album_id = ? WHERE id = ?', [albumRows[0].id, trackId])
      }
    }

    // Update scalar fields directly on the track row
    const fieldMap: Record<string, string> = {
      title: 'title',
      albumArtist: 'album_artist',
      year: 'year',
      genre: 'genre',
    }
    for (const [jsKey, dbCol] of Object.entries(fieldMap)) {
      if (Object.prototype.hasOwnProperty.call(updates, jsKey)) {
        db.run(`UPDATE tracks SET ${dbCol} = ? WHERE id = ?`, [(updates as Record<string, unknown>)[jsKey], trackId])
      }
    }

    persistDb()

    // Return the updated track
    const rows = execRows(`
      SELECT t.*, ar.name AS artist_name, al.name AS album_name
      FROM tracks t
      LEFT JOIN artists ar ON ar.id = t.artist_id
      LEFT JOIN albums  al ON al.id = t.album_id
      WHERE t.id = ?`, [trackId])
    return rows.length > 0 ? rowToTrack(rows[0]) : null
  })

  ipcMain.handle('db:remove-track', (_e, trackId: number) => {
    getDb().run('DELETE FROM tracks WHERE id = ?', [trackId])
    persistDb()
  })
}

