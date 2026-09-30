import { create } from 'zustand'
import type { Track } from '../types'
import type { RepeatMode } from '../types'
import { extractDominantColor } from '../utils/colorExtractor'
import { useLibraryStore } from './libraryStore'

interface PlayerState {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  isPlaying: boolean
  volume: number          // 0-1
  isMuted: boolean
  seekPosition: number    // seconds (updated by audio element)
  duration: number        // seconds
  shuffle: boolean
  repeat: RepeatMode
  showQueue: boolean      // queue panel visibility
  rightPanelTab: 'nowPlaying' | 'queue' | 'recent'
  isExpandedNowPlaying: boolean
  dominantColor: string

  // Actions
  playTrack: (track: Track, queue?: Track[]) => void
  togglePlay: () => void
  pause: () => void
  play: () => void
  next: () => void
  prev: () => void
  setVolume: (v: number) => void
  toggleMute: () => void
  setSeek: (s: number) => void
  setDuration: (d: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  addToQueue: (track: Track) => void
  playNext: (track: Track) => void
  addTracksToQueue: (tracks: Track[]) => void
  removeFromQueue: (index: number) => void
  reorderQueue: (fromIndex: number, toIndex: number) => void
  clearQueue: () => void
  toggleQueuePanel: () => void
  setRightPanelTab: (tab: 'nowPlaying' | 'queue' | 'recent') => void
  toggleRightPanel: (tab?: 'nowPlaying' | 'queue' | 'recent') => void
  toggleExpandedNowPlaying: () => void
  setExpandedNowPlaying: (val: boolean) => void
  setDominantColor: (color: string) => void
}

const SESSION_STORAGE_KEY = 'lokal_saved_session'

export interface SavedPlayerSession {
  track: Track
  queue: Track[]
  queueIndex: number
  seekPosition: number
  volume: number
  isMuted: boolean
  shuffle: boolean
  repeat: RepeatMode
}

export function loadPlayerSession(): SavedPlayerSession | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SavedPlayerSession
  } catch {
    return null
  }
}

export function persistPlayerSession(state: {
  currentTrack: Track | null
  queue: Track[]
  queueIndex: number
  seekPosition: number
  volume: number
  isMuted: boolean
  shuffle: boolean
  repeat: RepeatMode
}) {
  if (!state.currentTrack) return
  try {
    const data: SavedPlayerSession = {
      track: state.currentTrack,
      queue: state.queue,
      queueIndex: state.queueIndex,
      seekPosition: state.seekPosition,
      volume: state.volume,
      isMuted: state.isMuted,
      shuffle: state.shuffle,
      repeat: state.repeat,
    }
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(data))
  } catch (e) {
    console.error('Failed to persist player session:', e)
  }
}

const initialSession = loadPlayerSession()

export const usePlayerStore = create<PlayerState>((set, get) => ({
  currentTrack: initialSession?.track ?? null,
  queue: initialSession?.queue ?? [],
  queueIndex: initialSession?.queueIndex ?? 0,
  isPlaying: false, // always start paused; AudioEngine.onLoadedMetadata seeks then plays
  volume: initialSession?.volume ?? 0.8,
  isMuted: initialSession?.isMuted ?? false,
  seekPosition: initialSession?.seekPosition ?? 0,
  duration: initialSession?.track?.duration ?? 0,
  shuffle: initialSession?.shuffle ?? false,
  repeat: initialSession?.repeat ?? 'off',
  showQueue: false,
  rightPanelTab: 'nowPlaying',
  isExpandedNowPlaying: false,
  dominantColor: '#1e1e1e',

  playTrack: (track, queue) => {
    const q = queue ?? get().queue
    const idx = q.findIndex((t) => t.filePath === track.filePath)
    const nextState = {
      currentTrack: track,
      queue: q,
      queueIndex: idx >= 0 ? idx : 0,
      isPlaying: true,
      seekPosition: 0,
    }
    set(nextState)
    persistPlayerSession({ ...get(), ...nextState })
    if (track.id) window.lokal.db.recordPlay(track.id).catch(() => {})
    extractDominantColor(track.artworkPath, track.title).then((color) => {
      set({ dominantColor: color })
    })
  },

  togglePlay: () => set((s) => ({ isPlaying: !s.isPlaying })),
  pause: () => set({ isPlaying: false }),
  play: () => set({ isPlaying: true }),

  next: () => {
    const { queue, queueIndex, shuffle, repeat, currentTrack } = get()
    if (queue.length === 0) return
    let nextIdx: number
    if (shuffle) {
      nextIdx = Math.floor(Math.random() * queue.length)
    } else if (queueIndex < queue.length - 1) {
      nextIdx = queueIndex + 1
    } else if (repeat === 'all') {
      nextIdx = 0
    } else {
      // ── Spotify Smart Autoplay: Keep music going seamlessly ──
      const allTracks = useLibraryStore.getState().tracks
      if (allTracks.length > 0 && currentTrack) {
        const queuePaths = new Set(queue.map((t) => t.filePath.toLowerCase()))
        // 1. Same artist tracks not in queue
        let candidates = allTracks.filter(
          (t) =>
            t.artist &&
            currentTrack.artist &&
            t.artist.toLowerCase() === currentTrack.artist.toLowerCase() &&
            !queuePaths.has(t.filePath.toLowerCase())
        )
        // 2. Same album tracks if needed
        if (candidates.length < 3 && currentTrack.album && currentTrack.album !== 'Unknown Album') {
          const albumTracks = allTracks.filter(
            (t) =>
              t.album === currentTrack.album &&
              !queuePaths.has(t.filePath.toLowerCase()) &&
              !candidates.some((c) => c.filePath === t.filePath)
          )
          candidates.push(...albumTracks)
        }
        // 3. Complementary random tracks from library
        if (candidates.length < 5) {
          const remainder = allTracks
            .filter((t) => !queuePaths.has(t.filePath.toLowerCase()) && !candidates.some((c) => c.filePath === t.filePath))
            .sort(() => Math.random() - 0.5)
          candidates.push(...remainder.slice(0, 5 - candidates.length))
        }

        if (candidates.length > 0) {
          const autoplayTrack = candidates[0]
          const newQueue = [...queue, ...candidates]
          const newIndex = queue.length
          const nextState = {
            queue: newQueue,
            queueIndex: newIndex,
            currentTrack: autoplayTrack,
            isPlaying: true,
            seekPosition: 0,
          }
          set(nextState)
          persistPlayerSession({ ...get(), ...nextState })
          if (autoplayTrack.id) window.lokal.db.recordPlay(autoplayTrack.id).catch(() => {})
          extractDominantColor(autoplayTrack.artworkPath, autoplayTrack.title).then((color) => {
            set({ dominantColor: color })
          })
          window.dispatchEvent(
            new CustomEvent('lokal:toast', {
              detail: `Autoplay: Playing similar songs like "${autoplayTrack.title}"`,
            })
          )
          return
        }
      }

      set({ isPlaying: false })
      return
    }
    const track = queue[nextIdx]
    const nextState = { currentTrack: track, queueIndex: nextIdx, isPlaying: true, seekPosition: 0 }
    set(nextState)
    persistPlayerSession({ ...get(), ...nextState })
    if (track.id) window.lokal.db.recordPlay(track.id).catch(() => {})
    extractDominantColor(track.artworkPath, track.title).then((color) => {
      set({ dominantColor: color })
    })
  },

  prev: () => {
    const { queue, queueIndex, seekPosition } = get()
    if (seekPosition > 3) {
      set({ seekPosition: 0 })
      return
    }
    if (queue.length === 0) return
    const prevIdx = queueIndex > 0 ? queueIndex - 1 : 0
    const track = queue[prevIdx]
    const nextState = { currentTrack: track, queueIndex: prevIdx, isPlaying: true, seekPosition: 0 }
    set(nextState)
    persistPlayerSession({ ...get(), ...nextState })
    extractDominantColor(track.artworkPath, track.title).then((color) => {
      set({ dominantColor: color })
    })
  },

  setVolume: (v) => {
    const vol = Math.max(0, Math.min(1, v))
    set({ volume: vol, isMuted: false })
    persistPlayerSession({ ...get(), volume: vol, isMuted: false })
  },
  toggleMute: () => {
    const nextMuted = !get().isMuted
    set({ isMuted: nextMuted })
    persistPlayerSession({ ...get(), isMuted: nextMuted })
  },
  setSeek: (s) => set({ seekPosition: s }),
  setDuration: (d) => set({ duration: d }),

  toggleShuffle: () => {
    const nextShuffle = !get().shuffle
    set({ shuffle: nextShuffle })
    persistPlayerSession({ ...get(), shuffle: nextShuffle })
  },
  cycleRepeat: () => {
    const s = get()
    const nextRepeat: RepeatMode = s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off'
    set({ repeat: nextRepeat })
    persistPlayerSession({ ...get(), repeat: nextRepeat })
  },

  addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),

  playNext: (track) => set((s) => {
    if (s.queue.length === 0 || !s.currentTrack) {
      if (track.id) window.lokal.db.recordPlay(track.id).catch(() => {})
      return { queue: [track], queueIndex: 0, currentTrack: track, isPlaying: true, seekPosition: 0 }
    }
    const newQueue = [...s.queue]
    newQueue.splice(s.queueIndex + 1, 0, track)
    return { queue: newQueue }
  }),

  addTracksToQueue: (tracks) => set((s) => ({ queue: [...s.queue, ...tracks] })),

  removeFromQueue: (index) => set((s) => {
    const newQueue = s.queue.filter((_, i) => i !== index)
    // Adjust queueIndex if we removed something before or at current position
    let newIndex = s.queueIndex
    if (index < s.queueIndex) newIndex = s.queueIndex - 1
    else if (index === s.queueIndex) {
      // Removed the current track — play next if possible
      newIndex = Math.min(s.queueIndex, newQueue.length - 1)
    }
    return { queue: newQueue, queueIndex: Math.max(0, newIndex) }
  }),

  reorderQueue: (fromIndex, toIndex) => set((s) => {
    if (fromIndex === toIndex) return {}
    const newQueue = [...s.queue]
    const [moved] = newQueue.splice(fromIndex, 1)
    newQueue.splice(toIndex, 0, moved)
    // Keep queueIndex pointing at the same track
    let newIndex = s.queueIndex
    if (fromIndex === s.queueIndex) newIndex = toIndex
    else if (fromIndex < s.queueIndex && toIndex >= s.queueIndex) newIndex--
    else if (fromIndex > s.queueIndex && toIndex <= s.queueIndex) newIndex++
    return { queue: newQueue, queueIndex: newIndex }
  }),

  clearQueue: () => set({ queue: [], queueIndex: 0 }),
  toggleQueuePanel: () => set((s) => ({ showQueue: !s.showQueue })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab, showQueue: true }),
  toggleRightPanel: (tab) => set((s) => {
    if (s.showQueue && (!tab || s.rightPanelTab === tab)) {
      return { showQueue: false }
    }
    return { showQueue: true, rightPanelTab: tab || s.rightPanelTab }
  }),
  toggleExpandedNowPlaying: () => set((s) => ({ isExpandedNowPlaying: !s.isExpandedNowPlaying })),
  setExpandedNowPlaying: (val) => set({ isExpandedNowPlaying: val }),
  setDominantColor: (color) => set({ dominantColor: color }),
}))

// Extract dominant color if restored from saved session
if (initialSession?.track) {
  extractDominantColor(initialSession.track.artworkPath, initialSession.track.title).then((color) => {
    usePlayerStore.setState({ dominantColor: color })
  })
}

// Window beforeunload listener to guarantee latest seek position and state are preserved on quit
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    persistPlayerSession(usePlayerStore.getState())
  })
}
