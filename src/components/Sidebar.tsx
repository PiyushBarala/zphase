import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import type { Playlist, Track } from '../types'

// ── Icons ───────────────────────────────────────────────────────
const LibraryIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
  </svg>
)
const AddIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>
  </svg>
)
const HeartIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
  </svg>
)
const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="#1DB954" width="12" height="12">
    <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
  </svg>
)
const MusicIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
  </svg>
)
const PlaylistIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
  </svg>
)

const SIDEBAR_WIDTH_KEY = 'lokal_sidebar_width'
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 420
const SIDEBAR_DEFAULT = 256

type FilterTab = 'all' | 'playlists' | 'artists' | 'downloaded'

export function Sidebar({ onToggle }: { onToggle?: () => void }): React.JSX.Element {
  const navigate = useNavigate()
  const { playlists, tracks, refreshPlaylists } = useLibraryStore()
  const { currentTrack, isPlaying } = usePlayerStore()

  const [filter, setFilter] = useState<FilterTab>('all')
  const [searchFilter, setSearchFilter] = useState('')
  const [showSearch, setShowSearch] = useState(false)
  const [creatingNew, setCreatingNew] = useState(false)
  const [newName, setNewName] = useState('')
  const newInputRef = useRef<HTMLInputElement>(null)

  // ── Draggable width ──────────────────────────────────────────
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_WIDTH_KEY)
      if (saved) {
        const n = parseInt(saved, 10)
        if (!isNaN(n) && n >= SIDEBAR_MIN && n <= SIDEBAR_MAX) return n
      }
    } catch {}
    return SIDEBAR_DEFAULT
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartX = useRef(0)
  const dragStartWidth = useRef(0)

  const onDragHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragStartX.current = e.clientX
    dragStartWidth.current = width
    setIsDragging(true)
  }, [width])

  useEffect(() => {
    if (!isDragging) return
    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - dragStartX.current
      const newWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidth.current + delta))
      setWidth(newWidth)
    }
    const onMouseUp = () => {
      setIsDragging(false)
      setWidth((w) => {
        try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w)) } catch {}
        return w
      })
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDragging])

  const startNew = () => {
    setNewName('')
    setCreatingNew(true)
    setTimeout(() => newInputRef.current?.focus(), 50)
  }

  const commitNew = async () => {
    const trimmed = newName.trim()
    if (trimmed) {
      await window.lokal.db.createPlaylist(trimmed)
      await refreshPlaylists()
    }
    setCreatingNew(false)
  }

  const likedPlaylist = playlists.find((p) => p.id === 1)
  const userPlaylists = playlists.filter((p) => p.id !== 1)

  // Unique artists list
  const artistsList = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tracks) {
      if (t.artist && t.artist !== 'Unknown Artist') {
        map.set(t.artist, (map.get(t.artist) ?? 0) + 1)
      }
    }
    return [...map.entries()].map(([name, count]) => ({ name, count }))
  }, [tracks])

  // Filtered items
  const q = searchFilter.toLowerCase().trim()

  return (
    <aside
      className="flex-shrink-0 bg-[#121212] rounded-lg border border-white/5 flex flex-col overflow-hidden select-none relative"
      style={{ width, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}
    >
      {/* ── Top Quick Link: Download ── */}
      <div className="px-3 pt-3 pb-2 border-b border-white/5 flex flex-col gap-1 flex-shrink-0">
        <NavLink
          to="/download"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg font-bold text-sm transition-all ${
              isActive
                ? 'bg-[#282828] text-accent shadow-sm'
                : 'text-[#b3b3b3] hover:text-white hover:bg-white/5'
            }`
          }
        >
          <div className="w-6 h-6 rounded-md bg-accent/20 text-accent flex items-center justify-center flex-shrink-0">
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
            </svg>
          </div>
          <span>Download Music</span>
        </NavLink>
      </div>

      {/* ── Library Header ── */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <div
          onClick={() => {
            if (onToggle) {
              onToggle()
            } else {
              navigate('/library')
            }
          }}
          className="flex items-center gap-3 text-[#b3b3b3] hover:text-white cursor-pointer transition-colors"
        >
          <LibraryIcon />
          <span className="text-sm font-bold tracking-wide">Your Library</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={startNew}
            className="w-8 h-8 rounded-full flex items-center justify-center text-[#b3b3b3] hover:text-white hover:bg-white/10 transition-colors"
            title="Create playlist"
          >
            <AddIcon />
          </button>
        </div>
      </div>

      {/* ── Filter Pills ── */}
      <div className="flex items-center gap-2 px-3 py-2 overflow-x-auto no-scrollbar flex-shrink-0">
        <button
          onClick={() => setFilter(filter === 'playlists' ? 'all' : 'playlists')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
            filter === 'playlists'
              ? 'bg-white text-black'
              : 'bg-[#232323] text-white hover:bg-[#2a2a2a]'
          }`}
        >
          Playlists
        </button>
        <button
          onClick={() => setFilter(filter === 'artists' ? 'all' : 'artists')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
            filter === 'artists'
              ? 'bg-white text-black'
              : 'bg-[#232323] text-white hover:bg-[#2a2a2a]'
          }`}
        >
          Artists
        </button>
        <button
          onClick={() => setFilter(filter === 'downloaded' ? 'all' : 'downloaded')}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-all ${
            filter === 'downloaded'
              ? 'bg-white text-black'
              : 'bg-[#232323] text-white hover:bg-[#2a2a2a]'
          }`}
        >
          All Songs
        </button>
      </div>

      {/* ── Search in Library row ── */}
      <div className="flex items-center justify-between px-4 py-2 text-xs text-[#b3b3b3] flex-shrink-0">
        {showSearch ? (
          <div className="flex items-center gap-2 flex-1 bg-[#232323] rounded-md px-2 py-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              autoFocus
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search in Library"
              className="bg-transparent text-xs text-white placeholder:text-[#535353] outline-none flex-1 min-w-0"
            />
            <button
              onClick={() => {
                setShowSearch(false)
                setSearchFilter('')
              }}
              className="hover:text-white"
            >
              ✕
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={() => setShowSearch(true)}
              className="hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
              title="Search in Your Library"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
            </button>
            <span className="flex items-center gap-1 hover:text-white cursor-pointer transition-colors text-xs font-medium">
              Recents ≡
            </span>
          </>
        )}
      </div>

      {/* ── Scrollable Library Items List ── */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 flex flex-col gap-0.5">
        {/* Inline new playlist input */}
        {creatingNew && (
          <div className="flex items-center gap-2 px-2 py-2 mb-1 bg-[#1a1a1a] rounded-md border border-accent/40">
            <div className="w-11 h-11 rounded bg-[#282828] flex items-center justify-center text-[#b3b3b3]">
              <PlaylistIcon />
            </div>
            <input
              ref={newInputRef}
              value={newName}
              placeholder="My Playlist"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNew()
                if (e.key === 'Escape') setCreatingNew(false)
              }}
              onBlur={commitNew}
              className="flex-1 bg-transparent text-white text-sm outline-none font-medium placeholder:text-[#535353]"
            />
          </div>
        )}

        {/* 1. Liked Songs card (Spotify pinned card) */}
        {(filter === 'all' || filter === 'playlists') && (!q || 'liked songs'.includes(q)) && likedPlaylist && (
          <NavLink
            to="/liked"
            className={({ isActive }) =>
              `flex items-center gap-3 p-2 rounded-md transition-all group ${
                isActive ? 'bg-[#282828]' : 'hover:bg-[#1a1a1a]'
              }`
            }
          >
            <div className="w-12 h-12 rounded bg-gradient-to-br from-[#450af5] to-[#8e8ee5] flex items-center justify-center flex-shrink-0 shadow-md">
              <HeartIcon />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">Liked Songs</p>
              <div className="flex items-center gap-1 text-xs text-[#b3b3b3] mt-0.5">
                <PinIcon />
                <span>Playlist</span>
                <span>•</span>
                <span>{tracks.filter((t) => t.liked).length} songs</span>
              </div>
            </div>
            {/* Playing indicator */}
            {currentTrack && tracks.filter((t) => t.liked).some((t) => t.id === currentTrack.id) && isPlaying && (
              <div className="flex gap-0.5 items-end flex-shrink-0 h-4">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-0.5 bg-accent rounded-full animate-equalizer"
                    style={{ animationDelay: `${i * 0.15}s`, height: `${8 + i * 3}px` }}
                  />
                ))}
              </div>
            )}
          </NavLink>
        )}

        {/* 2. All Songs entry */}
        {(filter === 'all' || filter === 'downloaded') && (!q || 'all songs'.includes(q)) && (
          <NavLink
            to="/songs"
            className={({ isActive }) =>
              `flex items-center gap-3 p-2 rounded-md transition-all group ${
                isActive ? 'bg-[#282828]' : 'hover:bg-[#1a1a1a]'
              }`
            }
          >
            <div className="w-12 h-12 rounded bg-[#282828] flex items-center justify-center flex-shrink-0 text-accent">
              <MusicIcon />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">All Songs</p>
              <p className="text-xs text-[#b3b3b3] mt-0.5 truncate">
                Library • {tracks.length} songs
              </p>
            </div>
          </NavLink>
        )}

        {/* 3. User playlists */}
        {(filter === 'all' || filter === 'playlists') &&
          userPlaylists
            .filter((pl) => !q || pl.name.toLowerCase().includes(q))
            .map((pl) => {
              const isCurrentPlayingInPlaylist = false // Would need playlist tracks to check
              return (
                <NavLink
                  key={pl.id}
                  to={`/playlist/${pl.id}`}
                  className={({ isActive }) =>
                    `flex items-center gap-3 p-2 rounded-md transition-all group ${
                      isActive ? 'bg-[#282828]' : 'hover:bg-[#1a1a1a]'
                    }`
                  }
                >
                  {pl.artworkPath ? (
                    <img
                      src={'lokal://media/' + pl.artworkPath.replace(/\\/g, '/')}
                      alt=""
                      className="w-12 h-12 rounded object-cover flex-shrink-0 shadow-sm"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded bg-[#282828] group-hover:bg-[#333] flex items-center justify-center flex-shrink-0 text-[#b3b3b3] transition-colors">
                      <PlaylistIcon />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white truncate">{pl.name}</p>
                    <p className="text-xs text-[#b3b3b3] mt-0.5 truncate">
                      Playlist • {pl.trackCount ? `${pl.trackCount} ${pl.trackCount === 1 ? 'song' : 'songs'}` : 'Lokal'}
                    </p>
                  </div>
                </NavLink>
              )
            })}

        {/* 4. Artists */}
        {(filter === 'all' || filter === 'artists') &&
          artistsList
            .filter((a) => !q || a.name.toLowerCase().includes(q))
            .slice(0, 20)
            .map((artist) => (
              <div
                key={artist.name}
                onClick={() => navigate(`/artist/${encodeURIComponent(artist.name)}`)}
                className="flex items-center gap-3 p-2 rounded-md hover:bg-[#1a1a1a] transition-all cursor-pointer group"
              >
                <div className="w-12 h-12 rounded-full bg-[#282828] flex items-center justify-center flex-shrink-0 text-white font-bold text-sm shadow-md">
                  {artist.name[0]?.toUpperCase() ?? 'A'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white truncate">{artist.name}</p>
                  <p className="text-xs text-[#b3b3b3] mt-0.5 truncate">
                    Artist • {artist.count} songs
                  </p>
                </div>
              </div>
            ))}
      </div>

      {/* ── Drag Handle ─────────────────────────────────────────── */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize group z-10"
        title="Drag to resize"
      >
        {/* Visible indicator line */}
        <div
          className={`absolute inset-y-0 right-0 w-px transition-all duration-150 ${
            isDragging ? 'bg-accent w-0.5 shadow-[0_0_6px_rgba(29,185,84,0.6)]' : 'bg-transparent group-hover:bg-accent/40'
          }`}
        />
      </div>

      {/* Global drag cursor overlay when dragging */}
      {isDragging && (
        <div className="fixed inset-0 z-50 cursor-col-resize" style={{ pointerEvents: 'all' }} />
      )}
    </aside>
  )
}
