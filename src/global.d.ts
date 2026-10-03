import type { ScanProgress, Track, Album, Artist, Playlist, YtSearchResult, DownloadProgress, UpdateStatus } from './types'

type RepeatMode = 'off' | 'all' | 'one'

interface MiniPlayerState {
  currentTrack: Track | null
  isPlaying: boolean
  seekPosition: number
  duration: number
  volume: number
  isMuted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

interface MiniPlayerCommand {
  type: 'toggle-play' | 'next' | 'prev' | 'seek' | 'skip-relative' | 'seek-relative' | 'set-volume' | 'toggle-shuffle' | 'cycle-repeat'
  payload?: unknown
}

declare global {
  interface Window {
    lokal: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized?: () => Promise<boolean>
        toggleFullScreen?: () => Promise<void>
        isFullScreen?: () => Promise<boolean>
        onMaximizedChange?: (cb: (maximized: boolean) => void) => () => void
        onFullScreenChange?: (cb: (fullScreen: boolean) => void) => () => void
        onCloseRequested?: (cb: () => void) => () => void
        closeResponse?: (choice: 'quit' | 'tray') => void
      }
      shell: {
        showInFolder: (filePath: string) => Promise<void>
        deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>
      }
      library: {
        pickFolder: () => Promise<string | null>
        scan: (folderPath: string) => Promise<Track[]>
        onScanProgress: (cb: (progress: ScanProgress) => void) => () => void
        scanFile?: (filePath: string) => Promise<Track | null>
        onTracksUpdated?: (cb: () => void) => () => void
      }
      db: {
        getTracks: () => Promise<Track[]>
        getAlbums: () => Promise<Album[]>
        getArtists: () => Promise<Artist[]>
        getAlbumTracks: (albumId: number) => Promise<Track[]>
        getArtistTracks: (artistId: number) => Promise<Track[]>
        searchTracks: (query: string) => Promise<Track[]>
        updateTrack: (trackId: number, updates: {
          title?: string; artist?: string; albumArtist?: string;
          album?: string; year?: number | null; genre?: string | null
        }) => Promise<Track | null>
        removeTrack: (trackId: number) => Promise<void>
        getPlaylists: () => Promise<Playlist[]>
        createPlaylist: (name: string) => Promise<Playlist>
        renamePlaylist: (id: number, name: string) => Promise<void>
        deletePlaylist: (id: number) => Promise<void>
        getPlaylistTracks: (playlistId: number) => Promise<Track[]>
        addTrackToPlaylist: (playlistId: number, trackId: number) => Promise<void>
        removeTrackFromPlaylist: (playlistId: number, trackId: number) => Promise<void>
        reorderPlaylistTrack: (playlistId: number, trackId: number, newPos: number) => Promise<void>
        getTrackPlaylists: (trackId: number) => Promise<number[]>
        toggleLike: (trackId: number) => Promise<boolean>
        getLikedTracks: () => Promise<Track[]>
        recordPlay: (trackId: number) => Promise<void>
        getRecentlyPlayed: (limit?: number) => Promise<Track[]>
      }
      settings: {
        get: (key: string) => Promise<unknown>
        set: (key: string, value: unknown) => Promise<void>
      }
      app: {
        setAutostart: (enable: boolean) => Promise<boolean>
        getAutostart: () => Promise<boolean>
        forceQuit?: () => Promise<void>
      }
      feedback: {
        submit: (payload: { email: string; message: string; version: string }) => Promise<{ ok: boolean }>
      }
      miniplayer: {
        /** Open the always-on-top mini player window */
        open: () => Promise<void>
        /** Close the mini player window */
        close: () => Promise<void>
        /** Main window → main process → mini player: push player state */
        syncState: (state: MiniPlayerState) => void
        /** Mini player: subscribe to state pushed from main process */
        onState: (cb: (state: MiniPlayerState) => void) => () => void
        /** Mini player: send a playback command to the main window */
        sendCommand: (cmd: MiniPlayerCommand) => Promise<void>
        /** Main window: receive and execute commands from mini player */
        onCommand: (cb: (cmd: MiniPlayerCommand) => void) => () => void
        /** Main window: notified when mini player window closes */
        onClosed: (cb: () => void) => () => void
      }
      ytdlp: {
        search: (query: string, offset?: number, limit?: number) => Promise<YtSearchResult[]>
        getRelated: (videoId: string, offset?: number, limit?: number) => Promise<YtSearchResult[]>
        getPlaylist: (playlistUrl: string) => Promise<{ title: string; items: YtSearchResult[]; error?: string }>
        download: (opts: { videoId: string; title?: string; targetFolder?: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>
        cancel: (videoId: string) => Promise<boolean>
        getDefaultFolder: () => Promise<string>
        pickFolder: () => Promise<string | null>
        syncFolder: (folderPath?: string) => Promise<{ synced: number; error?: string }>
        onProgress: (cb: (progress: DownloadProgress) => void) => () => void
      }
      updater: {
        getVersion: () => Promise<string>
        getLastStatus: () => Promise<UpdateStatus>
        checkForUpdates: () => Promise<{ success: boolean; error?: string }>
        skipUpdate: (version?: string) => Promise<{ success: boolean }>
        downloadUpdate: () => Promise<{ success: boolean; error?: string }>
        openReleasePage: (url?: string) => Promise<{ success: boolean }>
        quitAndInstall: () => Promise<void>
        onStatus: (cb: (status: UpdateStatus) => void) => () => void
      }
    }
  }
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.svg' {
  const src: string
  export default src
}

export {}
