import React, { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { Sidebar } from './components/Sidebar'
import { NowPlayingBar } from './components/NowPlayingBar'
import { AudioEngine, seekAudio } from './components/AudioEngine'
import { QueuePanel } from './components/QueuePanel'
import { TopNav } from './components/TopNav'
import { zoomIn, zoomOut, resetZoom } from './components/SettingsMenu'
import { GlobalContextMenu } from './components/ContextMenu'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import { PlayerStateBroadcaster } from './components/PlayerStateBroadcaster'
import { AppSettingsProvider } from './contexts/AppSettingsContext'
import { HomeView } from './views/HomeView'
import { SongsView } from './views/SongsView'
import { AlbumsView } from './views/AlbumsView'
import { ArtistsView } from './views/ArtistsView'
import { SearchView } from './views/SearchView'
import { PlaylistView } from './views/PlaylistView'
import { MiniPlayerView } from './views/MiniPlayerView'
import { DownloadView } from './views/DownloadView'
import { NowPlayingExpandedView } from './components/NowPlayingExpandedView'
import { useLibraryStore } from './stores/libraryStore'
import { usePlayerStore } from './stores/playerStore'
import { initGlobalDownloadListener } from './stores/downloadStore'
import type { UpdateStatus } from './types'

function AppUpdateBanner() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [isDismissed, setIsDismissed] = useState(false)

  useEffect(() => {
    window.lokal?.updater?.getLastStatus().then(setUpdateStatus).catch(() => {})
    const unsub = window.lokal?.updater?.onStatus((st) => {
      setUpdateStatus(st)
      if (st.type === 'downloaded' || st.type === 'downloading') {
        setIsDismissed(false)
      }
    })
    return unsub
  }, [])

  if (isDismissed || !updateStatus) return null

  // Ready to install
  if (updateStatus.type === 'downloaded') {
    return (
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[200] bg-[#1ed760] text-black px-4 py-2 rounded-full shadow-2xl flex items-center gap-3 animate-fade-in text-xs font-semibold">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
        </svg>
        <span>Z Phase v{updateStatus.version} downloaded into app!</span>
        <button
          onClick={() => window.lokal?.updater?.quitAndInstall()}
          className="px-3 py-1 bg-black text-white rounded-full hover:bg-[#222] transition-transform active:scale-95 font-bold text-xs shadow-sm"
        >
          Restart & Install Now
        </button>
        <button
          onClick={() => setIsDismissed(true)}
          className="text-black/70 hover:text-black transition-colors ml-1 p-0.5"
          title="Dismiss"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
      </div>
    )
  }

  // Downloading in background
  if (updateStatus.type === 'downloading') {
    return (
      <div
        onClick={() => window.dispatchEvent(new CustomEvent('lokal:open-about'))}
        className="fixed top-12 left-1/2 -translate-x-1/2 z-[200] bg-[#222222]/95 backdrop-blur-md text-white border border-white/15 px-3.5 py-1.5 rounded-full shadow-2xl flex items-center gap-2.5 animate-fade-in text-xs cursor-pointer hover:border-accent/50 transition-all"
        title="Click to view download progress"
      >
        <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span className="text-[#b3b3b3]">Downloading update in background:</span>
        <span className="font-mono text-accent font-semibold">{updateStatus.percent ?? 0}%</span>
      </div>
    )
  }

  return null
}

function ToastNotification() {
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail
      setToast(msg)
    }
    window.addEventListener('lokal:toast', handler)
    return () => window.removeEventListener('lokal:toast', handler)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])

  if (!toast) return null

  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] bg-[#282828] text-white px-5 py-2.5 rounded-full shadow-2xl border border-white/15 text-sm font-medium flex items-center gap-2.5 animate-fade-in pointer-events-none">
      <span className="w-2 h-2 rounded-full bg-[#1DB954]" />
      <span>{toast}</span>
    </div>
  )
}

function LibraryView(): React.JSX.Element {
  return (
    <div className="flex flex-col h-full items-center justify-center text-[#535353]">
      <p className="text-sm">Your library overview</p>
    </div>
  )
}

// ── Keyboard shortcuts (only in main window) ─────────────────────
function useKeyboardShortcuts() {
  const { togglePlay, next, prev, setVolume, setSeek, volume, seekPosition, duration } = usePlayerStore()
  const navigate = useNavigate()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // Global zoom shortcuts (supporting all keyboard layouts, Shift, and Numpad)
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault()
          zoomIn()
          return
        }
        if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          zoomOut()
          return
        }
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault()
          resetZoom()
          return
        }
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          if (e.shiftKey || e.ctrlKey) next()
          else seekAudio(Math.min(seekPosition + 10, duration))
          break
        case 'ArrowLeft':
          if (e.shiftKey || e.ctrlKey) prev()
          else seekAudio(Math.max(seekPosition - 10, 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setVolume(Math.min(volume + 0.1, 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setVolume(Math.max(volume - 0.1, 0))
          break
        case 'KeyN':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            const name = `My Playlist #${Math.floor(Math.random() * 900 + 100)}`
            window.lokal.db.createPlaylist(name).then(async (created) => {
              await useLibraryStore.getState().refreshPlaylists()
              if (created?.id) {
                navigate(`/playlist/${created.id}`)
                window.dispatchEvent(new CustomEvent('lokal:toast', { detail: `Created ${name}` }))
              }
            }).catch(console.error)
          }
          break
        case 'KeyO':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            window.lokal.library.pickFolder().then(async (folder) => {
              if (!folder) return
              const { setScanFolder, setScanning, loadLibrary } = useLibraryStore.getState()
              setScanFolder(folder)
              setScanning(true)
              window.lokal.library.onScanProgress(() => {})
              await window.lokal.library.scan(folder)
              setScanning(false)
              await loadLibrary()
              window.dispatchEvent(new CustomEvent('lokal:toast', { detail: 'Music library scanned' }))
            }).catch(console.error)
          }
          break
        case 'KeyA':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            window.getSelection()?.selectAllChildren(document.body)
          }
          break
        case 'KeyK':
        case 'KeyL':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            navigate('/search')
            setTimeout(() => {
              const input = document.getElementById('top-search-input') as HTMLInputElement | null
              input?.focus()
              input?.select()
            }, 50)
          }
          break
        case 'KeyQ':
          if (e.ctrlKey && e.shiftKey) {
            e.preventDefault()
            window.lokal.window.close()
          } else if (e.ctrlKey) {
            e.preventDefault()
            usePlayerStore.getState().toggleQueuePanel()
          }
          break
        case 'Escape':
          if (window.lokal?.window?.isFullScreen) {
            window.lokal.window.isFullScreen().then((fs) => {
              if (fs) window.lokal.window.toggleFullScreen?.()
            }).catch(() => {})
          }
          break
        case 'F11':
          e.preventDefault()
          usePlayerStore.getState().toggleExpandedNowPlaying()
          break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, next, prev, setVolume, volume, seekPosition, duration, navigate])
}

// ── Mini player command handler ───────────────────────────────────
// Receives commands from the mini player window and executes them
// in the main window's Zustand store / audio element.
function useMiniPlayerCommands() {
  useEffect(() => {
    const unsub = window.lokal.miniplayer.onCommand((cmd) => {
      const store = usePlayerStore.getState()
      switch (cmd.type) {
        case 'toggle-play':   store.togglePlay(); break
        case 'next':          store.next(); break
        case 'prev': {
          if (store.seekPosition > 3) {
            seekAudio(0)
          } else {
            store.prev()
          }
          break
        }
        case 'seek':          seekAudio(cmd.payload as number); break
        case 'seek-relative':
        case 'skip-relative': {
          const delta = cmd.payload as number
          const cur = store.seekPosition
          const dur = store.duration
          seekAudio(Math.max(0, Math.min(cur + delta, dur)))
          break
        }
        case 'set-volume':    store.setVolume(cmd.payload as number); break
        case 'toggle-shuffle': store.toggleShuffle(); break
        case 'cycle-repeat':  store.cycleRepeat(); break
      }
    })
    return unsub
  }, [])
}

// ── Inner app (must be inside HashRouter for useNavigate) ─────────
function AppInner(): React.JSX.Element {
  const { loadLibrary } = useLibraryStore()
  const showQueue = usePlayerStore((s) => s.showQueue)
  const isExpandedNowPlaying = usePlayerStore((s) => s.isExpandedNowPlaying)
  useKeyboardShortcuts()
  useMiniPlayerCommands()

  useEffect(() => {
    loadLibrary().catch(console.error)

    // Listen for background track indexing updates from main process
    const unsubTracks = window.lokal?.library?.onTracksUpdated?.(() => {
      loadLibrary().catch(console.error)
    })

    // Auto-sync download/music folder in background on launch to ensure all downloaded songs appear
    window.lokal?.ytdlp?.syncFolder?.().then(async (res) => {
      if (res && res.synced > 0) {
        await loadLibrary()
      }
    }).catch(console.error)

    const cleanupDownloads = initGlobalDownloadListener()
    return () => {
      unsubTracks?.()
      cleanupDownloads()
    }
  }, [loadLibrary])

  return (
    <>
      <AudioEngine />
      <PlayerStateBroadcaster />
      <GlobalContextMenu />
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-black p-2 pt-0 gap-2 select-none">
        {/* Top bar drag region with Spotify navigation */}
        <TopNav />
        {/* 3-column layout: [Sidebar] [Main Content] [QueuePanel] */}
        <div className="flex flex-1 gap-2 overflow-hidden min-h-0">
          <Sidebar />
          <main className="flex-1 overflow-hidden bg-[#121212] rounded-lg border border-white/5 relative flex flex-col">
            <Routes>
              <Route path="/"             element={<HomeView />} />
              <Route path="/search"       element={<SearchView />} />
              <Route path="/library"      element={<LibraryView />} />
              <Route path="/songs"        element={<SongsView />} />
              <Route path="/albums"       element={<AlbumsView />} />
              <Route path="/album/:id"    element={<AlbumsView />} />
              <Route path="/artists"      element={<ArtistsView />} />
              <Route path="/artist/:id"   element={<ArtistsView />} />
              <Route path="/liked"        element={<PlaylistView />} />
              <Route path="/playlist/:id" element={<PlaylistView />} />
              <Route path="/download"     element={<DownloadView />} />
            </Routes>
          </main>
          {showQueue && <QueuePanel />}
        </div>
        {/* Bottom NowPlayingBar */}
        <NowPlayingBar />
      </div>
      {isExpandedNowPlaying && <NowPlayingExpandedView />}
      <AppUpdateBanner />
      <ToastNotification />
    </>
  )
}

// ── Root — detects mini player window by hash route ───────────────
export default function App(): React.JSX.Element {
  // The mini player window loads the same renderer with #/miniplayer.
  // Detect this BEFORE creating the router so we can render a completely
  // different layout (no sidebar, no NowPlayingBar, no AudioEngine).
  const isMiniPlayer = window.location.hash.startsWith('#/miniplayer')

  if (isMiniPlayer) {
    return (
      <HashRouter>
        <Routes>
          <Route path="/miniplayer" element={<MiniPlayerView />} />
        </Routes>
      </HashRouter>
    )
  }

  return (
    <AppSettingsProvider>
      <ConfirmDialogProvider />
      <HashRouter>
        <AppInner />
      </HashRouter>
    </AppSettingsProvider>
  )
}
