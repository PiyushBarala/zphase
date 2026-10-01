import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Window controls
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    toggleFullScreen: () => ipcRenderer.invoke('window:toggleFullScreen'),
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, max: boolean) => cb(max)
      ipcRenderer.on('window:maximized-change', handler)
      return () => ipcRenderer.removeListener('window:maximized-change', handler)
    },
    onFullScreenChange: (cb: (fullScreen: boolean) => void) => {
      const handler = (_: Electron.IpcRendererEvent, fs: boolean) => cb(fs)
      ipcRenderer.on('window:fullscreen-change', handler)
      return () => ipcRenderer.removeListener('window:fullscreen-change', handler)
    }
  },

  // Shell helpers
  shell: {
    showInFolder: (filePath: string) => ipcRenderer.invoke('shell:show-in-folder', filePath)
  },

  // Feedback / bug reports (proxied through main process to avoid CORS)
  feedback: {
    submit: (payload: { email: string; message: string; version: string }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('feedback:submit', payload),
  },

  // Library / scanner
  library: {
    pickFolder: () => ipcRenderer.invoke('library:pick-folder'),
    scan: (folderPath: string) => ipcRenderer.invoke('library:scan', folderPath),
    scanFile: (filePath: string) => ipcRenderer.invoke('library:scan-file', filePath),
    onTracksUpdated: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('library:tracks-updated', handler)
      return () => ipcRenderer.removeListener('library:tracks-updated', handler)
    },
    onScanProgress: (cb: (progress: { current: number; total: number; file: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { current: number; total: number; file: string }) => cb(data)
      ipcRenderer.on('library:scan-progress', handler)
      return () => ipcRenderer.removeListener('library:scan-progress', handler)
    }
  },

  // Database queries
  db: {
    getTracks: () => ipcRenderer.invoke('db:get-tracks'),
    getAlbums: () => ipcRenderer.invoke('db:get-albums'),
    getArtists: () => ipcRenderer.invoke('db:get-artists'),
    getAlbumTracks: (albumId: number) => ipcRenderer.invoke('db:get-album-tracks', albumId),
    getArtistTracks: (artistId: number) => ipcRenderer.invoke('db:get-artist-tracks', artistId),
    searchTracks: (query: string) => ipcRenderer.invoke('db:search-tracks', query),
    updateTrack: (trackId: number, updates: {
      title?: string; artist?: string; albumArtist?: string;
      album?: string; year?: number | null; genre?: string | null
    }) => ipcRenderer.invoke('db:update-track', trackId, updates),
    removeTrack: (trackId: number) => ipcRenderer.invoke('db:remove-track', trackId),

    // Playlists
    getPlaylists: () => ipcRenderer.invoke('db:get-playlists'),
    createPlaylist: (name: string) => ipcRenderer.invoke('db:create-playlist', name),
    renamePlaylist: (id: number, name: string) => ipcRenderer.invoke('db:rename-playlist', id, name),
    deletePlaylist: (id: number) => ipcRenderer.invoke('db:delete-playlist', id),
    getPlaylistTracks: (playlistId: number) => ipcRenderer.invoke('db:get-playlist-tracks', playlistId),
    addTrackToPlaylist: (playlistId: number, trackId: number) => ipcRenderer.invoke('db:add-track-to-playlist', playlistId, trackId),
    removeTrackFromPlaylist: (playlistId: number, trackId: number) => ipcRenderer.invoke('db:remove-track-from-playlist', playlistId, trackId),
    reorderPlaylistTrack: (playlistId: number, trackId: number, newPosition: number) => ipcRenderer.invoke('db:reorder-playlist-track', playlistId, trackId, newPosition),
    getTrackPlaylists: (trackId: number) => ipcRenderer.invoke('db:get-track-playlists', trackId),

    // Liked songs
    toggleLike: (trackId: number) => ipcRenderer.invoke('db:toggle-like', trackId),
    getLikedTracks: () => ipcRenderer.invoke('db:get-liked-tracks'),

    // Recently played
    recordPlay: (trackId: number) => ipcRenderer.invoke('db:record-play', trackId),
    getRecentlyPlayed: (limit?: number) => ipcRenderer.invoke('db:get-recently-played', limit ?? 20)
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value)
  },

  // App-level actions
  app: {
    setAutostart: (enable: boolean) => ipcRenderer.invoke('app:set-autostart', enable),
    getAutostart: () => ipcRenderer.invoke('app:get-autostart'),
    forceQuit: () => ipcRenderer.invoke('app:force-quit'),
  },

  // ── Mini player IPC bridge ─────────────────────────────────────
  miniplayer: {
    // Open / close the mini player window
    open: () => ipcRenderer.invoke('miniplayer:open'),
    close: () => ipcRenderer.invoke('miniplayer:close'),

    // Main window → main process → mini player: send player state
    syncState: (state: unknown) => ipcRenderer.send('miniplayer:sync-state', state),

    // Mini player window: subscribe to state pushed from main process
    onState: (cb: (state: unknown) => void) => {
      const handler = (_: Electron.IpcRendererEvent, state: unknown) => cb(state)
      ipcRenderer.on('miniplayer:state', handler)
      return () => ipcRenderer.removeListener('miniplayer:state', handler)
    },

    // Mini player window: send a playback command to main window
    sendCommand: (cmd: { type: string; payload?: unknown }) =>
      ipcRenderer.invoke('miniplayer:command', cmd),

    // Main window: receive and execute commands sent by mini player
    onCommand: (cb: (cmd: { type: string; payload?: unknown }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, cmd: { type: string; payload?: unknown }) => cb(cmd)
      ipcRenderer.on('miniplayer:execute', handler)
      return () => ipcRenderer.removeListener('miniplayer:execute', handler)
    },

    // Main window: notified when mini player window is closed
    onClosed: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on('miniplayer:closed', handler)
      return () => ipcRenderer.removeListener('miniplayer:closed', handler)
    }
  },

  // yt-dlp downloader
  ytdlp: {
    search: (query: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke('ytdlp:search', query, offset, limit),
    getRelated: (videoId: string, offset?: number, limit?: number) =>
      ipcRenderer.invoke('ytdlp:getRelated', videoId, offset, limit),
    download: (opts: { videoId: string; title?: string; targetFolder?: string }) =>
      ipcRenderer.invoke('ytdlp:download', opts),
    cancel: (videoId: string) => ipcRenderer.invoke('ytdlp:cancel', videoId),
    getDefaultFolder: () => ipcRenderer.invoke('ytdlp:get-default-folder'),
    pickFolder: () => ipcRenderer.invoke('ytdlp:pick-folder'),
    syncFolder: (folderPath?: string) => ipcRenderer.invoke('ytdlp:sync-folder', folderPath),
    onProgress: (cb: (progress: {
      videoId: string
      percent: number
      speed: string
      eta: string
      status: 'downloading' | 'converting' | 'completed' | 'error' | 'cancelled'
      filePath?: string
      error?: string
    }) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        data: {
          videoId: string
          percent: number
          speed: string
          eta: string
          status: 'downloading' | 'converting' | 'completed' | 'error' | 'cancelled'
          filePath?: string
          error?: string
        }
      ) => cb(data)
      ipcRenderer.on('ytdlp:progress', handler)
      return () => ipcRenderer.removeListener('ytdlp:progress', handler)
    }
  },

  // Auto-Updater
  updater: {
    getVersion: (): Promise<string> => ipcRenderer.invoke('updater:get-version'),
    getLastStatus: (): Promise<any> => ipcRenderer.invoke('updater:get-last-status'),
    checkForUpdates: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('updater:check'),
    skipUpdate: (version?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('updater:skip', version),
    downloadUpdate: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('updater:download'),
    openReleasePage: (url?: string): Promise<{ success: boolean }> => ipcRenderer.invoke('updater:open-url', url),
    quitAndInstall: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (status: {
      type: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
      currentVersion: string
      version?: string
      percent?: number
      bytesPerSecond?: number
      transferred?: number
      total?: number
      releaseNotes?: string
      downloadUrl?: string
      error?: string
      message?: string
    }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: any) => cb(data)
      ipcRenderer.on('updater:status', handler)
      return () => ipcRenderer.removeListener('updater:status', handler)
    }
  }
}

contextBridge.exposeInMainWorld('lokal', api)

export type LokalAPI = typeof api
