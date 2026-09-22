import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import initSqlJs, { type Database } from 'sql.js'

let db: Database | null = null

/**
 * Get the path to the SQLite database file in userData.
 */
function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'lokal.db')
}

/**
 * Get the path where extracted artwork PNGs are stored.
 */
export function getArtworkDir(): string {
  const dir = path.join(app.getPath('userData'), 'artwork')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Initialize sql.js and open (or create) the database.
 * Must be called once after app.whenReady().
 */
export async function initDb(): Promise<void> {
  const candidatePaths = [
    path.join(process.resourcesPath, 'sql-wasm.wasm'),
    path.join(process.resourcesPath, 'app.asar.unpacked/node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm'),
  ]
  const wasmPath = candidatePaths.find((p) => fs.existsSync(p)) || candidatePaths[2]

  const SQL = await initSqlJs({
    locateFile: () => wasmPath
  })

  const dbPath = getDbPath()
  let fileBuffer: Buffer | null = null

  if (fs.existsSync(dbPath)) {
    fileBuffer = fs.readFileSync(dbPath)
  }

  db = fileBuffer ? new SQL.Database(fileBuffer) : new SQL.Database()

  // Enable WAL mode equivalent (sql.js is in-memory so we persist on write)
  applySchema()
  console.log('[DB] Database initialized at:', dbPath)
}

/**
 * Persist the in-memory database back to disk.
 * Call after any write operation.
 */
export function persistDb(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(getDbPath(), buffer)
}

/**
 * Get the active database instance. Throws if not initialized.
 */
export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDb() first.')
  return db
}

/**
 * Create all tables if they don't already exist.
 */
function applySchema(): void {
  if (!db) return

  db.run(`
    CREATE TABLE IF NOT EXISTS artists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS albums (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL COLLATE NOCASE,
      artist_id     INTEGER REFERENCES artists(id) ON DELETE SET NULL,
      album_artist  TEXT,
      year          INTEGER,
      artwork_path  TEXT,
      UNIQUE(name, album_artist)
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path       TEXT    NOT NULL UNIQUE,
      file_hash       TEXT    NOT NULL,
      title           TEXT    NOT NULL,
      artist_id       INTEGER REFERENCES artists(id) ON DELETE SET NULL,
      album_id        INTEGER REFERENCES albums(id)  ON DELETE SET NULL,
      album_artist    TEXT,
      year            INTEGER,
      track_number    INTEGER,
      disc_number     INTEGER,
      duration        REAL    NOT NULL DEFAULT 0,
      bitrate         INTEGER,
      sample_rate     INTEGER,
      has_artwork     INTEGER NOT NULL DEFAULT 0,
      artwork_path    TEXT,
      genre           TEXT,
      comment         TEXT,
      liked           INTEGER NOT NULL DEFAULT 0,
      play_count      INTEGER NOT NULL DEFAULT 0,
      last_played_at  TEXT,
      date_added      TEXT    NOT NULL DEFAULT (datetime('now')),
      source_video_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_artist  ON tracks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_album   ON tracks(album_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_title   ON tracks(title COLLATE NOCASE);

    CREATE TABLE IF NOT EXISTS playlists (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      track_id    INTEGER NOT NULL REFERENCES tracks(id)    ON DELETE CASCADE,
      position    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE TABLE IF NOT EXISTS play_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
      played_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  // Safe migration for existing databases
  try {
    db.run('ALTER TABLE tracks ADD COLUMN source_video_id TEXT;')
  } catch {
    // Column already exists or newly created
  }

  // Ensure the built-in "Liked Songs" and "Downloads" playlists exist
  db.run(`
    INSERT OR IGNORE INTO playlists (id, name) VALUES (1, 'Liked Songs');
    INSERT OR IGNORE INTO playlists (id, name) VALUES (2, 'Downloads');
  `)
}
