import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { ArtworkCell } from '../components/ArtworkCell'
import { ContextMenu, type ContextMenuPosition } from '../components/ContextMenu'
import type { Track } from '../types'

function formatDuration(s: number): string {
  if (!isFinite(s) || isNaN(s) || s <= 0) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function formatTotalTime(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600)
  const mins = Math.floor((totalSeconds % 3600) / 60)
  const secs = Math.floor(totalSeconds % 60)
  if (hrs > 0) {
    return `${hrs} hr ${mins} min`
  }
  return `${mins} min ${secs} sec`
}

export function PlaylistView(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { playlists, refreshPlaylists } = useLibraryStore()
  const { playTrack, currentTrack, isPlaying, togglePlay, addTracksToQueue } = usePlayerStore()

  const isLiked = location.pathname === '/liked' || id === 'liked' || Number(id) === 1
  const playlistId = isLiked ? 1 : Number(id)

  const foundPlaylist = playlists.find((p) => p.id === playlistId)
  const playlist = isLiked
    ? (foundPlaylist ?? { id: 1, name: 'Liked Songs', createdAt: '', updatedAt: '' })
    : foundPlaylist

  const [tracks, setTracks] = useState<Track[]>([])
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState('')
  const [showDeleteModal, setShowDeleteModal] = useState(false)

  // In-playlist search & add
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Track[]>([])
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set())

  // Right-click context menu
  const [ctxMenu, setCtxMenu] = useState<{ track: Track; pos: ContextMenuPosition } | null>(null)

  const reloadTracks = useCallback(async () => {
    if (isLiked) {
      const list = await window.lokal.db.getLikedTracks()
      setTracks(list)
    } else if (playlistId && !isNaN(playlistId)) {
      const list = await window.lokal.db.getPlaylistTracks(playlistId)
      setTracks(list)
    }
  }, [isLiked, playlistId])

  useEffect(() => {
    reloadTracks()
  }, [reloadTracks])

  useEffect(() => {
    const onToast = () => {
      if (isLiked) reloadTracks()
    }
    window.addEventListener('lokal:toast', onToast)
    return () => window.removeEventListener('lokal:toast', onToast)
  }, [isLiked, reloadTracks])

  // Search tracks to add
  useEffect(() => {
    let active = true
    if (!searchQuery.trim()) {
      // Recommend up to 10 library songs not already in playlist
      window.lokal.db.getTracks().then((all) => {
        if (!active) return
        const existingSet = new Set(tracks.map((t) => t.id))
        const recommended = all.filter((t) => t.id && !existingSet.has(t.id)).slice(0, 8)
        setSearchResults(recommended)
      })
      return
    }

    const timer = setTimeout(async () => {
      const res = await window.lokal.db.searchTracks(searchQuery.trim())
      if (active) setSearchResults(res.slice(0, 15))
    }, 200)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [searchQuery, tracks])

  const confirmDelete = async () => {
    if (!playlist || isLiked) return
    await window.lokal.db.deletePlaylist(playlistId)
    await refreshPlaylists()
    setShowDeleteModal(false)
    navigate('/')
  }

  const handleRename = async () => {
    if (!newName.trim() || isLiked) return
    await window.lokal.db.renamePlaylist(playlistId, newName.trim())
    await refreshPlaylists()
    setRenaming(false)
  }

  const handleRemoveTrack = async (trackId: number) => {
    await window.lokal.db.removeTrackFromPlaylist(playlistId, trackId)
    setTracks((prev) => prev.filter((t) => t.id !== trackId))
  }

  const handleAddTrack = async (track: Track) => {
    if (!track.id) return
    await window.lokal.db.addTrackToPlaylist(playlistId, track.id)
    setAddedIds((prev) => new Set(prev).add(track.id!))
    await reloadTracks()
  }

  const handleToggleLike = async (track: Track) => {
    if (!track.id) return
    const liked = await window.lokal.db.toggleLike(track.id)
    setTracks((prev) => prev.map((t) => (t.id === track.id ? { ...t, liked } : t)))
  }

  const handleMoveUp = async (index: number) => {
    if (index <= 0) return
    const track = tracks[index]
    if (!track.id) return
    await window.lokal.db.reorderPlaylistTrack(playlistId, track.id, index - 1)
    await reloadTracks()
  }

  const handleMoveDown = async (index: number) => {
    if (index >= tracks.length - 1) return
    const track = tracks[index]
    if (!track.id) return
    await window.lokal.db.reorderPlaylistTrack(playlistId, track.id, index + 1)
    await reloadTracks()
  }

  const handlePlayAll = (shuffleMode = false) => {
    if (tracks.length === 0) return
    if (shuffleMode) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5)
      playTrack(shuffled[0], shuffled)
    } else {
      playTrack(tracks[0], tracks)
    }
  }

  const handleQueueAll = () => {
    if (tracks.length === 0) return
    addTracksToQueue(tracks)
  }

  if (!playlist) {
    return (
      <div className="flex items-center justify-center h-full text-[#535353]">
        Playlist not found.
      </div>
    )
  }

  const totalDuration = tracks.reduce((s, t) => s + (t.duration || 0), 0)
  const coverArtwork = isLiked
    ? null
    : (tracks.find((t) => t.artworkPath)?.artworkPath || playlist.artworkPath || null)

  return (
    <div className="flex flex-col h-full overflow-y-auto select-none">
      {/* ── Header ── */}
      <div className="flex items-end gap-6 p-8 bg-gradient-to-b from-[#2e2640] via-[#1a1625] to-[#121212] flex-shrink-0">
        {/* Cover Art */}
        <div className="w-48 h-48 rounded-xl overflow-hidden bg-gradient-to-br from-[#7c3aed] to-[#4c1d95] flex items-center justify-center shadow-2xl flex-shrink-0 border border-white/5">
          {isLiked ? (
            <svg viewBox="0 0 24 24" fill="white" width="76" height="76">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
            </svg>
          ) : coverArtwork ? (
            <img
              src={'lokal://media/' + coverArtwork.replace(/\\/g, '/')}
              alt={playlist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <svg viewBox="0 0 24 24" fill="white" width="68" height="68" className="opacity-80">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
            </svg>
          )}
        </div>

        {/* Playlist details */}
        <div className="flex-1 min-w-0 pb-1">
          <p className="text-xs font-bold text-white/70 uppercase tracking-wider mb-2">Playlist</p>

          {renaming ? (
            <div className="flex items-center gap-3 mb-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="bg-[#282828] text-white text-3xl font-bold px-3 py-1 rounded-lg border border-white/20 focus:outline-none focus:border-[#1DB954]"
              />
              <button
                onClick={handleRename}
                className="px-4 py-1.5 rounded-full bg-[#1DB954] text-black font-semibold text-sm hover:scale-105 transition-transform"
              >
                Save
              </button>
              <button
                onClick={() => setRenaming(false)}
                className="px-4 py-1.5 rounded-full bg-white/10 text-white text-sm hover:bg-white/20 transition-colors"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 mb-3 group">
              <h1
                className={`text-4xl font-extrabold text-white tracking-tight ${!isLiked ? 'cursor-pointer hover:underline' : ''}`}
                onClick={() => {
                  if (!isLiked) {
                    setNewName(playlist.name)
                    setRenaming(true)
                  }
                }}
                title={!isLiked ? 'Click to rename playlist' : undefined}
              >
                {playlist.name}
              </h1>
              {!isLiked && (
                <button
                  onClick={() => {
                    setNewName(playlist.name)
                    setRenaming(true)
                  }}
                  className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-white transition-opacity p-1 rounded hover:bg-white/10"
                  title="Rename"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-[#b3b3b3]">
            <span className="font-semibold text-white">Lokal</span>
            <span>•</span>
            <span>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'}</span>
            {totalDuration > 0 && (
              <>
                <span>•</span>
                <span>{formatTotalTime(totalDuration)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Controls Row ── */}
      <div className="flex items-center gap-4 px-8 py-5 bg-[#121212] flex-shrink-0 border-b border-[#282828]/60">
        {tracks.length > 0 && (
          <>
            {/* Play Button */}
            <button
              onClick={() => handlePlayAll(false)}
              className="w-14 h-14 rounded-full bg-[#1DB954] flex items-center justify-center text-black hover:scale-105 active:scale-95 transition-all shadow-xl hover:bg-[#1ed760]"
              title="Play playlist"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28" className="ml-1">
                <path d="M8 5v14l11-7z"/>
              </svg>
            </button>

            {/* Shuffle Button */}
            <button
              onClick={() => handlePlayAll(true)}
              className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all hover:scale-105"
              title="Shuffle play"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/>
              </svg>
            </button>

            {/* Add to Queue Button */}
            <button
              onClick={handleQueueAll}
              className="px-4 py-2 rounded-full border border-white/20 text-[#b3b3b3] hover:text-white hover:border-white text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
              title="Add all songs to queue"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
              </svg>
              Add to Queue
            </button>
          </>
        )}

        {/* Delete Playlist Button */}
        {!isLiked && (
          <button
            onClick={() => setShowDeleteModal(true)}
            className="ml-auto px-4 py-2 rounded-full border border-white/20 text-[#b3b3b3] hover:text-red-400 hover:border-red-500/50 text-xs font-semibold uppercase tracking-wider transition-colors flex items-center gap-1.5"
            title="Delete this playlist"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
            Delete Playlist
          </button>
        )}
      </div>

      {/* ── Tracks Table ── */}
      <div className="px-8 pt-4 pb-12 flex-1">
        {tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-[#b3b3b3]">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4 text-[#535353]">
              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
            <p className="text-base font-semibold text-white mb-1">
              {isLiked ? 'No liked songs yet' : 'Your playlist is empty'}
            </p>
            <p className="text-sm text-[#727272] max-w-sm">
              {isLiked
                ? 'Save songs you love by tapping the heart icon anywhere in Z Phase.'
                : 'Find songs in your library below and add them directly to this playlist.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-[#b3b3b3] text-left border-b border-[#282828] text-xs font-semibold uppercase tracking-wider">
                <th className="px-3 py-3 w-12 text-center">#</th>
                <th className="px-3 py-3">Title</th>
                <th className="px-3 py-3 hidden md:table-cell">Album</th>
                <th className="px-3 py-3 w-28 text-center">Reorder</th>
                <th className="px-3 py-3 w-20 text-right">Duration</th>
                <th className="px-3 py-3 w-12 text-center"></th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, i) => {
                const isActive = currentTrack?.filePath === track.filePath
                return (
                  <tr
                    key={track.id || track.filePath}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setCtxMenu({ track, pos: { x: e.clientX, y: e.clientY } })
                    }}
                    className={`group border-b border-[#282828]/40 hover:bg-[#282828]/70 transition-colors ${
                      isActive ? 'text-[#1DB954]' : 'text-white'
                    }`}
                  >
                    {/* Track Number / Play Indicator */}
                    <td
                      className="px-3 py-2.5 text-center text-[#b3b3b3] cursor-pointer"
                      onClick={() => (isActive ? togglePlay() : playTrack(track, tracks))}
                    >
                      <span className="group-hover:hidden">
                        {isActive && isPlaying ? (
                          <span className="text-[#1DB954] text-xs font-bold">▶</span>
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span className="hidden group-hover:inline-block text-white text-xs">
                        {isActive && isPlaying ? '❚❚' : '▶'}
                      </span>
                    </td>

                    {/* Title + Artist + Thumbnail */}
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <ArtworkCell
                          artworkPath={track.artworkPath}
                          seed={track.title}
                          className="w-10 h-10 rounded shadow-md text-sm flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <p
                            className={`font-semibold truncate cursor-pointer hover:underline ${
                              isActive ? 'text-[#1DB954]' : 'text-white'
                            }`}
                            onClick={() => (isActive ? togglePlay() : playTrack(track, tracks))}
                          >
                            {track.title}
                          </p>
                          <p className="text-xs text-[#b3b3b3] truncate">{track.artist}</p>
                        </div>
                      </div>
                    </td>

                    {/* Album */}
                    <td className="px-3 py-2.5 text-[#b3b3b3] hidden md:table-cell truncate max-w-[180px]">
                      {track.album || '—'}
                    </td>

                    {/* Reorder Buttons (Move Up / Down) */}
                    <td className="px-3 py-2.5 text-center">
                      {!isLiked && (
                        <div className="flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            disabled={i === 0}
                            onClick={() => handleMoveUp(i)}
                            className="p-1 rounded text-[#b3b3b3] hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent"
                            title="Move Up"
                          >
                            ▲
                          </button>
                          <button
                            disabled={i === tracks.length - 1}
                            onClick={() => handleMoveDown(i)}
                            className="p-1 rounded text-[#b3b3b3] hover:text-white hover:bg-white/10 disabled:opacity-20 disabled:hover:bg-transparent"
                            title="Move Down"
                          >
                            ▼
                          </button>
                        </div>
                      )}
                    </td>

                    {/* Duration */}
                    <td className="px-3 py-2.5 text-[#b3b3b3] text-right tabular-nums text-xs">
                      {formatDuration(track.duration)}
                    </td>

                    {/* Like / Remove Actions */}
                    <td className="px-3 py-2.5 text-center">
                      <div className="flex items-center justify-end gap-2">
                        {/* Like button */}
                        <button
                          onClick={() => handleToggleLike(track)}
                          className={`p-1 transition-transform hover:scale-110 ${
                            track.liked ? 'text-[#1DB954]' : 'opacity-0 group-hover:opacity-70 hover:!opacity-100 text-white'
                          }`}
                          title={track.liked ? 'Remove from Liked' : 'Like'}
                        >
                          <svg viewBox="0 0 24 24" fill={track.liked ? '#1DB954' : 'currentColor'} width="16" height="16">
                            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                          </svg>
                        </button>

                        {/* Remove from playlist button */}
                        {!isLiked && (
                          <button
                            onClick={() => track.id && handleRemoveTrack(track.id)}
                            className="opacity-0 group-hover:opacity-70 hover:!opacity-100 text-[#b3b3b3] hover:text-red-400 transition-all p-1"
                            title="Remove from playlist"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* ── Search and Add Songs Section (Spotify Style) ── */}
        {!isLiked && (
          <div className="mt-12 pt-8 border-t border-[#282828]">
            <h2 className="text-xl font-bold text-white mb-2">Let's find something for your playlist</h2>
            <div className="relative max-w-md mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for songs or artists to add..."
                className="w-full bg-[#242424] text-white text-sm pl-10 pr-4 py-2.5 rounded-full border border-transparent focus:border-white/20 focus:outline-none placeholder-[#727272]"
              />
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="w-4 h-4 text-[#727272] absolute left-3.5 top-1/2 -translate-y-1/2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#727272] hover:text-white text-xs p-1"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Results / Suggestions */}
            {searchResults.length > 0 && (
              <div className="flex flex-col gap-1.5 max-w-2xl">
                <p className="text-xs font-semibold text-[#b3b3b3] uppercase tracking-wider mb-1">
                  {searchQuery ? 'Search Results' : 'Recommended Songs'}
                </p>
                {searchResults.map((track) => {
                  const alreadyInPlaylist = tracks.some((t) => t.id === track.id)
                  const justAdded = Boolean(track.id && addedIds.has(track.id))

                  return (
                    <div
                      key={track.id || track.filePath}
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-white/5 transition-colors gap-3"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <ArtworkCell
                          artworkPath={track.artworkPath}
                          seed={track.title}
                          className="w-10 h-10 rounded shadow flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{track.title}</p>
                          <p className="text-xs text-[#b3b3b3] truncate">{track.artist}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-xs text-[#727272] tabular-nums">
                          {formatDuration(track.duration)}
                        </span>
                        <button
                          disabled={alreadyInPlaylist || justAdded}
                          onClick={() => handleAddTrack(track)}
                          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                            alreadyInPlaylist || justAdded
                              ? 'bg-white/10 text-white/50 cursor-default'
                              : 'bg-white text-black hover:scale-105 active:scale-95'
                          }`}
                        >
                          {alreadyInPlaylist || justAdded ? '✓ Added' : '+ Add'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right-Click Context Menu ── */}
      {ctxMenu && (
        <ContextMenu
          track={ctxMenu.track}
          position={ctxMenu.pos}
          onClose={() => setCtxMenu(null)}
          onRemoveFromPlaylist={!isLiked ? handleRemoveTrack : undefined}
          onTrackUpdated={reloadTracks}
        />
      )}

      {/* ── Custom In-App Delete Confirmation Modal (Replaces Browser confirm()) ── */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm animate-fade-in p-4">
          <div className="bg-[#282828] border border-white/10 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-2">Delete from Your Library?</h3>
            <p className="text-sm text-[#b3b3b3] mb-6 leading-relaxed">
              This will delete <span className="font-semibold text-white">"{playlist.name}"</span> from your library. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="px-5 py-2 text-sm font-semibold text-white hover:bg-white/10 rounded-full transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-5 py-2 text-sm font-semibold bg-red-600 hover:bg-red-500 text-white rounded-full transition-colors shadow-lg"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function LikedView(): React.JSX.Element {
  return <PlaylistView />
}
