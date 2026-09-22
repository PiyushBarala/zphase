import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import type { YtSearchResult, DownloadItem, Track } from '../types'

function PreviewThumbnail({
  src,
  alt = '',
  iconSize = 20,
}: {
  src?: string
  alt?: string
  iconSize?: number
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLoaded(false)
    setError(false)

    if (!src) {
      setError(true)
      return
    }

    // Fallback if the image takes longer than 4.5 seconds to load
    timeoutRef.current = setTimeout(() => {
      setLoaded((isLoaded) => {
        if (!isLoaded) setError(true)
        return isLoaded
      })
    }, 4500)

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [src])

  const handleLoad = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setLoaded(true)
    setError(false)
  }

  const handleError = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setError(true)
  }

  if (error || !src) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#2a2a2a] to-[#181818] flex items-center justify-center text-[#555] select-none">
        <svg viewBox="0 0 24 24" fill="currentColor" width={iconSize} height={iconSize}>
          <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
        </svg>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full bg-[#1e1e1e] overflow-hidden">
      {!loaded && (
        <div className="absolute inset-0 bg-[#282828] animate-pulse flex items-center justify-center text-[#555]">
          <svg viewBox="0 0 24 24" fill="currentColor" width={iconSize} height={iconSize}>
            <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
          </svg>
        </div>
      )}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={handleLoad}
        onError={handleError}
        className={`w-full h-full object-cover transition-opacity duration-300 select-none ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  )
}

import { useDownloadStore } from '../stores/downloadStore'

export function DownloadView(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams()
  const seedVideoId = searchParams.get('seedVideoId')
  const seedTitle = searchParams.get('seedTitle')
  const isRelatedMode = Boolean(seedVideoId)

  const { scanFolder, loadLibrary, refreshPlaylists, tracks } = useLibraryStore()
  const { playTrack } = usePlayerStore()

  const {
    query,
    setQuery,
    results,
    setResults,
    appendResults,
    hasSearched,
    setHasSearched,
    isSearching,
    setIsSearching,
    isLoadingMore,
    setIsLoadingMore,
    hasMore,
    setHasMore,
    searchOffset,
    setSearchOffset,
    searchError,
    setSearchError,
    targetFolder,
    setTargetFolder,
    downloads,
    addDownload,
    updateDownload,
    clearFinishedDownloads,
    downloadSimultaneously,
    setDownloadSimultaneously,
    isDownloadingAll,
    setIsDownloadingAll,
    downloadAllProgress,
    setDownloadAllProgress,
  } = useDownloadStore()

  const searchInputRef = useRef<HTMLInputElement>(null)
  const lastSeedIdRef = useRef<string | null>(null)

  // Initialize download folder (prioritizing user's scanFolder, else default music folder)
  useEffect(() => {
    if (!targetFolder) {
      if (scanFolder) {
        setTargetFolder(scanFolder)
      } else {
        window.lokal.ytdlp.getDefaultFolder().then((folder) => {
          if (folder) setTargetFolder(folder)
        }).catch(console.error)
      }
    }
  }, [scanFolder, targetFolder, setTargetFolder])

  // Load related tracks when seedVideoId changes
  useEffect(() => {
    if (seedVideoId) {
      // If we already have results loaded for this seedVideoId, retain them!
      if (lastSeedIdRef.current === seedVideoId && results.length > 0) {
        return
      }
      lastSeedIdRef.current = seedVideoId
      setIsSearching(true)
      setHasSearched(true)
      setHasMore(true)
      setSearchError(null)
      setSearchOffset(1)
      window.lokal.ytdlp.getRelated(seedVideoId, 1, 20).then((items) => {
        setResults(items)
        setHasMore(items.length >= 20)
        setSearchOffset(1 + items.length + 1) // +1 for the skipped seed track
      }).catch((err) => {
        console.error('[DownloadView] Failed to fetch related tracks:', err)
        setResults([])
        setHasMore(false)
        setSearchError(err?.message || 'Network error: Could not fetch YouTube Mix tracks. Check your connection.')
      }).finally(() => {
        setIsSearching(false)
      })
    } else {
      lastSeedIdRef.current = null
    }
  }, [seedVideoId, results.length, setIsSearching, setHasSearched, setHasMore, setSearchError, setSearchOffset, setResults])

  // Download progress is managed globally via initGlobalDownloadListener() in downloadStore.ts


  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const q = query.trim()
    if (!q) return

    // Clear related mode if user submits a new search
    if (isRelatedMode) {
      setSearchParams({})
    }

    setIsSearching(true)
    setHasSearched(true)
    setHasMore(true)
    setSearchError(null)
    setSearchOffset(1)
    try {
      const items = await window.lokal.ytdlp.search(q, 1, 8)
      setResults(items)
      setHasMore(items.length >= 8)
      setSearchOffset(1 + items.length)
    } catch (err: any) {
      console.error('Search failed:', err)
      setResults([])
      setHasMore(false)
      setSearchError(err?.message || 'Network error: Could not reach YouTube. Please check your connection and try again.')
    } finally {
      setIsSearching(false)
    }
  }

  const handleSelectSuggestion = (suggest: string) => {
    setQuery(suggest)
    if (isRelatedMode) {
      setSearchParams({})
    }
    setIsSearching(true)
    setHasSearched(true)
    setHasMore(true)
    setSearchError(null)
    setSearchOffset(1)
    window.lokal.ytdlp.search(suggest, 1, 8).then((items) => {
      setResults(items)
      setHasMore(items.length >= 8)
      setSearchOffset(1 + items.length)
      setIsSearching(false)
    }).catch((err: any) => {
      setResults([])
      setHasMore(false)
      setSearchError(err?.message || 'Network error: Could not reach YouTube. Please check your connection and try again.')
      setIsSearching(false)
    })
  }

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return

    setIsLoadingMore(true)
    try {
      if (isRelatedMode && seedVideoId) {
        const nextItems = await window.lokal.ytdlp.getRelated(seedVideoId, searchOffset, 20)
        if (!nextItems || nextItems.length === 0) {
          setHasMore(false)
        } else {
          setResults((prev: YtSearchResult[]) => {
            const seen = new Set(prev.map((p) => p.id))
            const filtered = nextItems.filter((n) => !seen.has(n.id))
            return [...prev, ...filtered]
          })
          setSearchOffset((prev: number) => prev + nextItems.length)
          if (nextItems.length < 20) {
            setHasMore(false)
          }
        }
      } else {
        const q = query.trim()
        if (!q) return
        const nextItems = await window.lokal.ytdlp.search(q, searchOffset, 8)
        if (!nextItems || nextItems.length === 0) {
          setHasMore(false)
        } else {
          setResults((prev: YtSearchResult[]) => {
            const seen = new Set(prev.map((p) => p.id))
            const filtered = nextItems.filter((n) => !seen.has(n.id))
            return [...prev, ...filtered]
          })
          setSearchOffset((prev: number) => prev + nextItems.length)
          if (nextItems.length < 8) {
            setHasMore(false)
          }
        }
      }
    } catch (err) {
      console.error('Failed to load more results:', err)
      setHasMore(false)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const handlePickFolder = async () => {
    const picked = await window.lokal.ytdlp.pickFolder()
    if (picked) {
      setTargetFolder(picked)
    }
  }

  const startDownload = useCallback(async (item: YtSearchResult): Promise<{ success: boolean; filePath?: string }> => {
    // Add to downloads map in store
    const newItem: DownloadItem = {
      ...item,
      percent: 0,
      speed: '',
      eta: '',
      status: 'downloading',
    }
    addDownload(newItem)

    try {
      const res = await window.lokal.ytdlp.download({
        videoId: item.id,
        title: item.title,
        targetFolder: targetFolder || undefined,
      })

      if (!res.success && res.error) {
        updateDownload(item.id, { status: 'error', error: res.error })
        return { success: false }
      }

      // The main process has already indexed the file and added it to the
      // Downloads playlist atomically. The global listener in downloadStore.ts
      // handles the UI refresh (loadLibrary + refreshPlaylists + toast).
      return { success: true, filePath: res.filePath }
    } catch (err: any) {
      updateDownload(item.id, { status: 'error', error: err?.message || 'Download failed' })
      return { success: false }
    }
  }, [targetFolder, addDownload, updateDownload])

  const cancelDownload = async (videoId: string) => {
    await window.lokal.ytdlp.cancel(videoId)
    updateDownload(videoId, { status: 'cancelled' })
  }

  const playDownloadedFile = (filePath?: string) => {
    if (!filePath) return
    // Match against indexed tracks in libraryStore
    const match = tracks.find((t) => t.filePath.toLowerCase() === filePath.toLowerCase())
    if (match) {
      playTrack(match)
    } else {
      // Create temporary track object
      const fallbackTrack: Track = {
        filePath,
        fileHash: filePath,
        title: filePath.split(/[\\/]/).pop()?.replace(/\.mp3$/i, '') || 'Downloaded Song',
        artist: 'Unknown Artist',
        albumArtist: 'Unknown Artist',
        album: 'Downloads',
        year: null,
        trackNumber: null,
        discNumber: null,
        duration: 0,
        bitrate: null,
        sampleRate: null,
        hasArtwork: false,
        artworkPath: null,
        genre: null,
        comment: null,
        liked: false,
        playCount: 0,
        lastPlayedAt: null,
        dateAdded: new Date().toISOString(),
      }
      playTrack(fallbackTrack)
    }
  }

  // ── "Download all" handler with Simultaneous concurrency support ──
  const handleDownloadAll = async () => {
    if (isDownloadingAll || results.length === 0) return

    const pending = results.filter((r) => {
      const d = downloads.get(r.id)
      return !d || (d.status !== 'completed' && d.status !== 'downloading' && d.status !== 'converting')
    })

    if (pending.length === 0) {
      window.dispatchEvent(new CustomEvent('lokal:toast', { detail: 'All tracks are already downloaded' }))
      return
    }

    setIsDownloadingAll(true)
    setDownloadAllProgress({ current: 0, total: pending.length })

    const downloadedVideoIds: string[] = []
    const CONCURRENCY_LIMIT = downloadSimultaneously ? 3 : 1
    const queue = [...pending]
    let activeWorkers = 0
    let completedCount = 0

    await new Promise<void>((resolve) => {
      const runNext = () => {
        if (queue.length === 0 && activeWorkers === 0) {
          resolve()
          return
        }

        while (activeWorkers < CONCURRENCY_LIMIT && queue.length > 0) {
          const item = queue.shift()!
          activeWorkers++

          startDownload(item).then((res) => {
            if (res.success) {
              downloadedVideoIds.push(item.id)
            }
          }).catch((err) => {
            console.error('[handleDownloadAll] Error downloading track:', item.title, err)
          }).finally(() => {
            completedCount++
            setDownloadAllProgress({ current: completedCount, total: pending.length })
            activeWorkers--
            runNext()
          })
        }
      }

      runNext()
    })

    setIsDownloadingAll(false)
    setDownloadAllProgress(null)

    // Ensure 100% of downloaded files in the target folder are indexed in SQLite
    // (catches any edge cases where the per-download indexing may have failed)
    try {
      await window.lokal.ytdlp.syncFolder(targetFolder || undefined)
    } catch (e) {
      console.error('[DownloadView] Sync folder error:', e)
    }

    // Refresh the UI once for all completed downloads
    await loadLibrary()
    await refreshPlaylists()

    if (downloadedVideoIds.length > 0) {
      // Create a named radio/mix playlist if in related mix mode
      const radioName = isRelatedMode ? `Mix: ${seedTitle || 'Radio'}` : `Downloads (${new Date().toLocaleDateString()})`
      try {
        const pl = await window.lokal.db.createPlaylist(radioName)
        if (pl?.id) {
          const allTracks = await window.lokal.db.getTracks()
          for (const vid of downloadedVideoIds) {
            const match = allTracks.find((t) => t.sourceVideoId === vid)
            if (match?.id) {
              await window.lokal.db.addTrackToPlaylist(pl.id, match.id)
            }
          }
          await refreshPlaylists()
          window.dispatchEvent(
            new CustomEvent('lokal:toast', {
              detail: `Saved ${downloadedVideoIds.length} tracks to Downloads & "${radioName}"`,
            })
          )
        }
      } catch (err) {
        console.error('[DownloadView] Failed to create playlist:', err)
      }
    }
  }

  const downloadList = Array.from(downloads.values()).reverse()
  const activeCount = downloadList.filter((d) => d.status === 'downloading' || d.status === 'converting').length

  return (
<div className="flex flex-col h-full bg-[#121212] text-white overflow-y-auto select-none">
      {/* ── Top Hero Header ── */}
      <div className={`px-8 pt-8 pb-6 flex-shrink-0 border-b border-white/5 ${
        isRelatedMode
          ? 'bg-gradient-to-b from-[#1a2538] to-[#121212]'
          : 'bg-gradient-to-b from-[#1a3826] to-[#121212]'
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center shadow-lg ${
                isRelatedMode
                  ? 'bg-blue-500/20 border border-blue-500/30 text-blue-400 shadow-blue-500/10'
                  : 'bg-accent/20 border border-accent/30 text-accent shadow-accent/10'
              }`}>
                {isRelatedMode ? (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <h1
                    className="text-xl md:text-2xl font-extrabold tracking-tight text-white truncate max-w-[400px] lg:max-w-[560px]"
                    title={isRelatedMode ? `Related to: ${seedTitle || 'Track'}` : 'Search & Download'}
                  >
                    {isRelatedMode ? `Related to: ${seedTitle || 'Track'}` : 'Search & Download'}
                  </h1>
                  {isRelatedMode && (
                    <span className="flex-shrink-0 text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      YouTube Mix
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#b3b3b3] mt-0.5 truncate max-w-[620px]">
                  {isRelatedMode
                    ? 'Songs frequently listened to together on YouTube. Preview, download individually, or download all.'
                    : 'Search songs by title or artist — downloads directly into your local library as MP3 with tags & artwork.'}
                </p>
              </div>
            </div>
          </div>

          {/* Right Action: Target Folder Selector & Back button */}
          <div className="flex items-center gap-3 flex-shrink-0">
            {isRelatedMode && (
              <button
                onClick={() => setSearchParams({})}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-semibold transition-all hover:scale-105 cursor-pointer"
              >
                ← Back to Search
              </button>
            )}

            <div className="flex items-center gap-2.5 bg-black/40 backdrop-blur-md px-3.5 py-2 rounded-xl border border-white/10 text-xs">
              <span className="text-[#888]">Saving to:</span>
              <span className="font-mono text-white/90 truncate max-w-[180px]" title={targetFolder}>
                {targetFolder || 'Default Music Folder'}
              </span>
              <button
                onClick={handlePickFolder}
                className="text-accent hover:underline font-semibold flex-shrink-0 ml-1 cursor-pointer"
              >
                Change
              </button>
            </div>
          </div>
        </div>

        {/* ── Search Input Box (always accessible, submitting clears related mode) ── */}
        <form onSubmit={handleSearch} className="mt-6 flex items-center gap-3 max-w-2xl">
          <div className="relative flex-1 group">
            <div className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-[#b3b3b3] group-focus-within:text-white transition-colors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="18" height="18">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                isRelatedMode
                  ? `Search another song instead of "${seedTitle && seedTitle.length > 25 ? seedTitle.slice(0, 25) + '...' : (seedTitle || 'this')}"...`
                  : "Enter song name, artist, or lyrics..."
              }
              className="w-full bg-[#242424] hover:bg-[#2a2a2a] focus:bg-[#282828] text-white text-sm rounded-full pl-11 pr-10 py-3.5 outline-none ring-1 ring-white/10 focus:ring-2 focus:ring-accent transition-all shadow-inner"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  searchInputRef.current?.focus()
                }}
                className="absolute inset-y-0 right-3.5 flex items-center text-[#888] hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching || !query.trim()}
            className="px-6 py-3.5 rounded-full bg-accent hover:bg-[#1ed760] disabled:bg-[#282828] disabled:text-[#535353] text-black font-bold text-sm tracking-wide transition-all shadow-lg hover:scale-105 active:scale-95 disabled:scale-100 flex items-center gap-2 flex-shrink-0 cursor-pointer"
          >
            {isSearching ? (
              <>
                <span className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
                Searching…
              </>
            ) : (
              'Search'
            )}
          </button>
        </form>
      </div>

      {/* ── Content Body ── */}
      <div className="flex-1 p-8 flex flex-col gap-8 max-w-6xl">
        {/* ── 1. Active Downloads Section (if any exist) ── */}
        {downloadList.length > 0 && (
          <section className="bg-[#151515] p-5 rounded-2xl border border-white/5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-white">Downloads & Queue</h2>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-white/10 text-white/80 font-mono">
                  {downloadList.length} {downloadList.length === 1 ? 'item' : 'items'}
                </span>
                {activeCount > 0 && (
                  <span className="text-xs text-accent animate-pulse font-medium">
                    • {activeCount} in progress
                  </span>
                )}
              </div>

              <button
                onClick={() => clearFinishedDownloads()}
                className="text-xs text-[#888] hover:text-white transition-colors cursor-pointer"
              >
                Clear finished
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {downloadList.map((item) => {
                const isDownloading = item.status === 'downloading'
                const isConverting = item.status === 'converting'
                const isCompleted = item.status === 'completed'
                const isError = item.status === 'error'
                const isCancelled = item.status === 'cancelled'

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-3.5 p-3 rounded-xl bg-[#181818] border border-white/5 hover:border-white/10 transition-all shadow-md relative overflow-hidden"
                  >
                    {/* Thumbnail */}
                    <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 relative">
                      <PreviewThumbnail src={item.thumbnail} alt={item.title} iconSize={22} />
                      {isCompleted && (
                        <div className="absolute inset-0 bg-accent/30 flex items-center justify-center">
                          <span className="text-white font-bold text-sm">✓</span>
                        </div>
                      )}
                    </div>

                    {/* Info + Progress Bar */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-white truncate" title={item.title}>
                          {item.title}
                        </p>
                        <span className="text-xs font-mono text-[#b3b3b3] flex-shrink-0">
                          {isCompleted
                            ? 'Ready'
                            : isConverting
                            ? 'Converting…'
                            : isError
                            ? 'Failed'
                            : isCancelled
                            ? 'Cancelled'
                            : `${Math.round(item.percent)}%`}
                        </span>
                      </div>

                      <p className="text-xs text-[#888] truncate mt-0.5">{item.uploader}</p>

                      {/* Progress bar */}
                      <div className="mt-2 w-full h-1.5 bg-[#282828] rounded-full overflow-hidden relative">
                        <div
                          className={`h-full transition-all duration-300 rounded-full ${
                            isCompleted
                              ? 'bg-accent w-full'
                              : isError
                              ? 'bg-red-500 w-full'
                              : isCancelled
                              ? 'bg-yellow-600 w-full'
                              : 'bg-accent'
                          }`}
                          style={{
                            width: isCompleted || isError || isCancelled ? '100%' : `${item.percent}%`,
                          }}
                        />
                      </div>

                      {/* Meta stats (speed, eta) */}
                      {(isDownloading || isConverting) && (
                        <div className="flex items-center justify-between text-[10px] text-[#777] mt-1 font-mono">
                          <span>{item.speed ? `${item.speed}` : 'Downloading…'}</span>
                          <span>{item.eta ? `ETA ${item.eta}` : ''}</span>
                        </div>
                      )}

                      {isError && (
                        <p className="text-[10px] text-red-400 truncate mt-1 flex items-center gap-1" title={item.error}>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                          <span>{item.error || 'Download failed'}</span>
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {isError && (
                        <button
                          onClick={() => startDownload(item)}
                          className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white hover:text-accent border border-white/10 text-xs font-medium transition-all hover:scale-105 active:scale-95 flex items-center gap-1.5 cursor-pointer shadow-sm"
                          title="Retry download"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12">
                            <path d="M1 4v6h6M23 20v-6h-6" />
                            <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                          </svg>
                          <span>Retry</span>
                        </button>
                      )}

                      {isCompleted && item.filePath && (
                        <button
                          onClick={() => playDownloadedFile(item.filePath)}
                          className="w-8 h-8 rounded-full bg-accent hover:bg-[#1ed760] text-black flex items-center justify-center transition-transform hover:scale-110 active:scale-95 shadow"
                          title="Play now"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </button>
                      )}

                      {(isDownloading || isConverting) && (
                        <button
                          onClick={() => cancelDownload(item.id)}
                          className="p-1.5 text-[#888] hover:text-white hover:bg-white/10 rounded-full transition-colors"
                          title="Cancel download"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {/* ── 2. Search / Related Results Section ── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-tight">
                {isSearching
                  ? (isRelatedMode ? 'Loading YouTube Mix…' : 'Searching YouTube…')
                  : isRelatedMode
                  ? `Mix Tracks (${results.length})`
                  : hasSearched
                  ? `Results for "${query}" (${results.length})`
                  : 'Search Results'}
              </h2>
            </div>

            {/* Actions on results list */}
            {results.length > 0 && !isSearching && (
              <div className="flex items-center gap-2.5">
                {/* Simultaneous download toggle */}
                <button
                  type="button"
                  onClick={() => setDownloadSimultaneously(!downloadSimultaneously)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer select-none ${
                    downloadSimultaneously
                      ? 'bg-accent/15 border-accent/40 text-accent hover:bg-accent/25'
                      : 'bg-white/5 border-white/10 text-[#888] hover:text-white hover:bg-white/10'
                  }`}
                  title="When enabled, downloads multiple songs at the same time (up to 3 simultaneous downloads)"
                >
                  <span
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold transition-transform ${
                      downloadSimultaneously ? 'bg-accent text-black scale-110' : 'bg-white/20 text-white'
                    }`}
                  >
                    {downloadSimultaneously ? '✓' : ''}
                  </span>
                  <span>Simultaneous (3x)</span>
                </button>

                {/* "Download all" action button */}
                <button
                  onClick={handleDownloadAll}
                  disabled={isDownloadingAll}
                  className="px-4 py-2 rounded-full bg-accent hover:bg-[#1ed760] disabled:bg-[#282828] text-black font-bold text-xs tracking-wide transition-all shadow-md flex items-center gap-2 hover:scale-105 active:scale-95 disabled:scale-100 cursor-pointer"
                >
                  {isDownloadingAll ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                      <span>Downloading ({downloadAllProgress?.current}/{downloadAllProgress?.total})…</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                      </svg>
                      <span>Download All</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* State: Searching */}
          {isSearching && (
            <div className="flex flex-col items-center justify-center py-16 text-[#888] gap-3">
              <span className="w-8 h-8 border-3 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm">
                {isRelatedMode ? 'Fetching YouTube Mix playlist without downloading...' : 'Fetching songs without downloading...'}
              </p>
            </div>
          )}

          {/* State: Network error */}
          {!isSearching && searchError && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-[#888] gap-3 bg-red-500/5 border border-red-500/20 rounded-2xl p-6">
              <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24">
                  <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold text-white">Network Connection Error</p>
                <p className="text-xs text-[#aaa] mt-1 max-w-md">{searchError}</p>
              </div>
              <button
                onClick={() => (query ? handleSearch() : window.location.reload())}
                className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-all hover:scale-105 active:scale-95 cursor-pointer mt-1 flex items-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="12" height="12">
                  <path d="M1 4v6h6M23 20v-6h-6" />
                  <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
                </svg>
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* State: No results after search */}
          {!isSearching && hasSearched && !searchError && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[#888] gap-2">
              <svg viewBox="0 0 24 24" fill="currentColor" width="48" height="48" className="opacity-30">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
              </svg>
              <p className="text-base font-semibold text-white">No matches found</p>
              <p className="text-xs text-[#666]">Try checking spelling or typing a broader search term.</p>
            </div>
          )}

          {/* State: Initial landing hint before searching */}
          {!isSearching && !hasSearched && (
            <div className="flex flex-col items-center justify-center py-16 text-center text-[#888] gap-3 bg-[#151515] rounded-2xl border border-white/5 p-8">
              <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-white/50 mb-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="32" height="32">
                  <path d="m21 21-4.35-4.35" />
                  <circle cx="11" cy="11" r="8" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-white">Search any song by name</h3>
              <p className="text-sm text-[#b3b3b3] max-w-md">
                No URLs or links needed. Simply type your favorite tracks or artists above to preview results and download directly as tagged MP3s.
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {['AP Dhillon Desires', 'Dope Shope', 'Arijit Singh', 'Shape of You', 'Diljit Dosanjh'].map((suggest) => (
                  <button
                    key={suggest}
                    onClick={() => handleSelectSuggestion(suggest)}
                    className="text-xs px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-[#b3b3b3] hover:text-white transition-all cursor-pointer"
                  >
                    "{suggest}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results List */}
          {!isSearching && results.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {results.map((item, idx) => {
                const currentDownload = downloads.get(item.id)
                const isDownloading = currentDownload?.status === 'downloading' || currentDownload?.status === 'converting'
                const isCompleted = currentDownload?.status === 'completed'

                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-4 p-2.5 rounded-xl hover:bg-[#1e1e1e] transition-all group select-none border border-transparent hover:border-white/5"
                  >
                    {/* Index */}
                    <span className="text-xs text-[#666] w-5 text-center font-mono flex-shrink-0">
                      {idx + 1}
                    </span>

                    {/* Thumbnail with duration badge */}
                    <div className="relative w-20 h-12 rounded-lg bg-[#282828] overflow-hidden flex-shrink-0 shadow">
                      <PreviewThumbnail src={item.thumbnail} alt={item.title} iconSize={20} />
                      <span className="absolute bottom-1 right-1 bg-black/80 px-1 py-0.5 rounded text-[10px] font-mono text-white/90 z-10 pointer-events-none">
                        {item.durationString}
                      </span>
                    </div>

                    {/* Title & Uploader */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate group-hover:text-accent transition-colors" title={item.title}>
                        {item.title}
                      </p>
                      <p className="text-xs text-[#888] truncate mt-0.5 flex items-center gap-1">
                        <span>{item.uploader}</span>
                      </p>
                    </div>

                    {/* Download / Action button */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {isCompleted ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-accent flex items-center gap-1 bg-accent/10 px-2.5 py-1 rounded-full border border-accent/20">
                            ✓ In Library
                          </span>
                          {currentDownload.filePath && (
                            <button
                              onClick={() => playDownloadedFile(currentDownload.filePath)}
                              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold text-xs transition-transform hover:scale-105"
                            >
                              ▶ Play
                            </button>
                          )}
                        </div>
                      ) : isDownloading ? (
                        <div className="flex items-center gap-2 bg-[#282828] px-3 py-1.5 rounded-full text-xs font-mono text-white">
                          <span className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                          <span>{Math.round(currentDownload?.percent || 0)}%</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => startDownload(item)}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 hover:bg-accent text-white hover:text-black font-semibold text-xs tracking-wide transition-all hover:scale-105 active:scale-95 shadow cursor-pointer"
                        >
                          <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                          </svg>
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Load More Button */}
              {hasMore ? (
                <div className="flex justify-center pt-5 pb-8">
                  <button
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 active:bg-white/15 border border-white/10 hover:border-white/20 text-white font-semibold text-xs tracking-wide transition-all hover:scale-105 active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-md group select-none"
                  >
                    {isLoadingMore ? (
                      <>
                        <span className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        <span>Loading more results…</span>
                      </>
                    ) : (
                      <>
                        <svg
                          viewBox="0 0 24 24"
                          fill="currentColor"
                          width="14"
                          height="14"
                          className="text-accent group-hover:rotate-90 transition-transform duration-200"
                        >
                          <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
                        </svg>
                        <span>Load more results</span>
                      </>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-6 text-xs text-[#666] select-none">
                  You've reached the end of the results
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
