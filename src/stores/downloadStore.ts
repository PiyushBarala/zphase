import { create } from 'zustand'
import type { YtSearchResult, DownloadItem, DownloadProgress } from '../types'
import { useLibraryStore } from './libraryStore'

interface DownloadState {
  query: string
  results: YtSearchResult[]
  hasSearched: boolean
  isSearching: boolean
  isLoadingMore: boolean
  hasMore: boolean
  searchOffset: number
  searchError: string | null

  seedVideoId: string | null
  seedTitle: string | null
  isRelatedMode: boolean

  targetFolder: string
  downloadSimultaneously: boolean
  isDownloadingAll: boolean
  downloadAllProgress: { current: number; total: number } | null

  downloads: Map<string, DownloadItem>

  // Actions
  setQuery: (q: string) => void
  setResults: (results: YtSearchResult[] | ((prev: YtSearchResult[]) => YtSearchResult[])) => void
  appendResults: (items: YtSearchResult[]) => void
  setHasSearched: (v: boolean) => void
  setIsSearching: (v: boolean) => void
  setIsLoadingMore: (v: boolean) => void
  setHasMore: (v: boolean) => void
  setSearchOffset: (offset: number | ((prev: number) => number)) => void
  setSearchError: (err: string | null) => void
  setRelatedSeed: (seedVideoId: string | null, seedTitle: string | null) => void
  setTargetFolder: (folder: string) => void
  setDownloadSimultaneously: (v: boolean | ((prev: boolean) => boolean)) => void
  setIsDownloadingAll: (v: boolean) => void
  setDownloadAllProgress: (p: { current: number; total: number } | null) => void

  addDownload: (item: DownloadItem) => void
  updateDownload: (videoId: string, update: Partial<DownloadItem>) => void
  removeDownload: (videoId: string) => void
  clearFinishedDownloads: () => void
}

export const useDownloadStore = create<DownloadState>((set, get) => ({
  query: '',
  results: [],
  hasSearched: false,
  isSearching: false,
  isLoadingMore: false,
  hasMore: true,
  searchOffset: 1,
  searchError: null,

  seedVideoId: null,
  seedTitle: null,
  isRelatedMode: false,

  targetFolder: '',
  downloadSimultaneously: true,
  isDownloadingAll: false,
  downloadAllProgress: null,

  downloads: new Map<string, DownloadItem>(),

  setQuery: (query) => set({ query }),
  setResults: (results) =>
    set((state) => ({
      results: typeof results === 'function' ? results(state.results) : results,
    })),
  appendResults: (newItems) =>
    set((state) => {
      const existingIds = new Set(state.results.map((r) => r.id))
      const filtered = newItems.filter((i) => !existingIds.has(i.id))
      return { results: [...state.results, ...filtered] }
    }),
  setHasSearched: (hasSearched) => set({ hasSearched }),
  setIsSearching: (isSearching) => set({ isSearching }),
  setIsLoadingMore: (isLoadingMore) => set({ isLoadingMore }),
  setHasMore: (hasMore) => set({ hasMore }),
  setSearchOffset: (searchOffset) =>
    set((state) => ({
      searchOffset: typeof searchOffset === 'function' ? searchOffset(state.searchOffset) : searchOffset,
    })),
  setSearchError: (searchError) => set({ searchError }),

  setRelatedSeed: (seedVideoId, seedTitle) =>
    set({
      seedVideoId,
      seedTitle,
      isRelatedMode: Boolean(seedVideoId),
    }),

  setTargetFolder: (targetFolder) => set({ targetFolder }),
  setDownloadSimultaneously: (downloadSimultaneously) =>
    set((state) => ({
      downloadSimultaneously:
        typeof downloadSimultaneously === 'function'
          ? downloadSimultaneously(state.downloadSimultaneously)
          : downloadSimultaneously,
    })),
  setIsDownloadingAll: (isDownloadingAll) => set({ isDownloadingAll }),
  setDownloadAllProgress: (downloadAllProgress) => set({ downloadAllProgress }),

  addDownload: (item) =>
    set((state) => {
      const next = new Map(state.downloads)
      next.set(item.id, item)
      return { downloads: next }
    }),

  updateDownload: (videoId, update) =>
    set((state) => {
      const next = new Map(state.downloads)
      const existing = next.get(videoId)
      if (existing) {
        next.set(videoId, { ...existing, ...update })
      }
      return { downloads: next }
    }),

  removeDownload: (videoId) =>
    set((state) => {
      const next = new Map(state.downloads)
      next.delete(videoId)
      return { downloads: next }
    }),

  clearFinishedDownloads: () =>
    set((state) => {
      const next = new Map(state.downloads)
      for (const [id, d] of next.entries()) {
        if (d.status === 'completed' || d.status === 'error' || d.status === 'cancelled') {
          next.delete(id)
        }
      }
      return { downloads: next }
    }),
}))

/**
 * @deprecated The main process now handles indexing and playlist insertion
 * atomically when a download completes. This function is kept as a no-op
 * to avoid breaking any references, but it does nothing.
 */
export async function ensureTrackInDownloadsPlaylist(_filePath?: string, _videoId?: string): Promise<void> {
  // No-op: the main process (ytdlp.ts → scanAndIndexFile with addToDownloads=true)
  // now handles this atomically before the 'completed' IPC event is emitted.
}


/**
 * Global IPC progress listener — initialized once at the application level
 * so downloads continue tracking accurately across all view navigations.
 */
let isListenerInitialized = false

export function initGlobalDownloadListener(): () => void {
  if (isListenerInitialized || typeof window === 'undefined' || !window.lokal?.ytdlp?.onProgress) {
    return () => {}
  }
  isListenerInitialized = true

  const unsub = window.lokal.ytdlp.onProgress((progress: DownloadProgress) => {
    useDownloadStore.getState().updateDownload(progress.videoId, {
      percent: progress.percent,
      speed: progress.speed,
      eta: progress.eta,
      status: progress.status,
      filePath: progress.filePath,
      error: progress.error,
    })

    if (progress.status === 'completed') {
      // The main process has already indexed the track and added it to the
      // Downloads playlist atomically before sending this event.
      // We only need to refresh the renderer's UI state.
      ;(async () => {
        await useLibraryStore.getState().loadLibrary()
        await useLibraryStore.getState().refreshPlaylists()
        window.dispatchEvent(
          new CustomEvent('lokal:toast', {
            detail: 'Track downloaded and added to Downloads playlist',
          })
        )
      })().catch(console.error)
    }
  })

  return () => {
    unsub()
    isListenerInitialized = false
  }
}

