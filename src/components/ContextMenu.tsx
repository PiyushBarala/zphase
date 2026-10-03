import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import type { Track, Playlist } from '../types'
import { usePlayerStore } from '../stores/playerStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useContextMenuStore } from '../stores/contextMenuStore'
import { useSelectionStore } from '../stores/selectionStore'
import { showConfirm } from './ConfirmDialog'

export interface ContextMenuPosition {
  x: number
  y: number
}

interface ContextMenuProps {
  track: Track
  position: ContextMenuPosition
  onClose: () => void
  onEditMetadata?: (track: Track) => void
  onTrackUpdated?: () => void
  onRemoveFromPlaylist?: (trackId: number) => void
}

function MenuItem({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false,
  hasSubmenu = false,
}: {
  label: string
  icon?: React.ReactNode
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  hasSubmenu?: boolean
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`flex items-center gap-3 w-full px-3 py-2 text-sm text-left transition-colors rounded-md
        ${disabled ? 'text-[#535353] cursor-default' : danger
          ? 'text-red-400 hover:bg-red-900/30'
          : 'text-[#e0e0e0] hover:bg-[#3a3a3a]'}
      `}
    >
      {icon && <span className="w-4 h-4 flex-shrink-0 opacity-70">{icon}</span>}
      <span className="flex-1">{label}</span>
      {hasSubmenu && <span className="text-[#535353]">›</span>}
    </button>
  )
}

function Divider() {
  return <div className="my-1 border-t border-[#3a3a3a]" />
}

export function ContextMenu({ track, position, onClose, onEditMetadata, onTrackUpdated, onRemoveFromPlaylist }: ContextMenuProps) {
  const navigate = useNavigate()
  const menuRef = useRef<HTMLDivElement>(null)
  const { addToQueue, playNext } = usePlayerStore()
  const { playlists, refreshPlaylists } = useLibraryStore()
  const { enterSelectionMode } = useSelectionStore()
  const [showPlaylists, setShowPlaylists] = useState(false)
  const [playlistSubmenuPos, setPlaylistSubmenuPos] = useState({ x: 0, y: 0 })

  // Constrain position to viewport
  const [pos, setPos] = useState(position)
  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    setPos({
      x: position.x + rect.width > vw ? vw - rect.width - 8 : position.x,
      y: position.y + rect.height > vh ? vh - rect.height - 8 : position.y,
    })
  }, [position])

  // Close on click-outside or Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onMouse = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onMouse)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onMouse)
    }
  }, [onClose])

  const handlePlayNext = () => {
    playNext(track)
    onClose()
  }

  const handleAddToQueue = () => {
    addToQueue(track)
    onClose()
  }

  const handleShowInFolder = () => {
    window.lokal.shell.showInFolder(track.filePath)
    onClose()
  }

  const handleToggleLike = async () => {
    if (!track.id) return
    await window.lokal.db.toggleLike(track.id)
    onTrackUpdated?.()
    onClose()
  }

  const handleAddToPlaylist = async (playlistId: number, playlistName: string) => {
    let trackId = track.id
    if (!trackId) {
      try {
        const all = await window.lokal.db.getTracks()
        const match = all.find((t) => t.filePath === track.filePath)
        if (match?.id) trackId = match.id
      } catch (err) {
        console.error('[ContextMenu] Track lookup error:', err)
      }
    }
    if (!trackId) {
      console.error('[ContextMenu] Track has no ID to add:', track)
      onClose()
      return
    }

    try {
      await window.lokal.db.addTrackToPlaylist(playlistId, trackId)
      onTrackUpdated?.()
      window.dispatchEvent(
        new CustomEvent('lokal:toast', {
          detail: `Added "${track.title}" to ${playlistName}`,
        })
      )
      window.dispatchEvent(
        new CustomEvent('lokal:playlist-updated', {
          detail: playlistId,
        })
      )
    } catch (err) {
      console.error('[ContextMenu] Failed to add track to playlist:', err)
    } finally {
      setShowPlaylists(false)
      onClose()
    }
  }

  const handleRemoveFromLibrary = async () => {
    if (!track.id) return
    onClose()
    const confirmed = await showConfirm({
      title: 'Remove from library',
      message: `Remove "${track.title}" from your library? This cannot be undone.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    await window.lokal.db.removeTrack(track.id)
    onTrackUpdated?.()
  }

  const userPlaylists = playlists.filter((p) => p.id !== 1)

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-50 min-w-[220px] bg-[#282828] border border-[#3a3a3a] rounded-lg shadow-2xl py-1.5 px-1"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Track info header */}
      <div className="px-3 py-2 mb-1 border-b border-[#3a3a3a]">
        <p className="text-xs font-semibold text-white truncate">{track.title}</p>
        <p className="text-xs text-[#b3b3b3] truncate">{track.artist}</p>
      </div>

      {/* Select multiple */}
      <MenuItem
        label="Select"
        onClick={() => {
          enterSelectionMode(track)
          onClose()
        }}
        icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>}
      />

      <Divider />

      <MenuItem
        label="Play next"
        onClick={handlePlayNext}
        icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>}
      />

      <MenuItem
        label="Add to queue"
        onClick={handleAddToQueue}
        icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/></svg>}
      />

      {/* Add to playlist */}
      <div
        className="relative"
        onMouseEnter={() => setShowPlaylists(true)}
        onMouseLeave={() => setShowPlaylists(false)}
      >
        <MenuItem
          label="Add to playlist"
          hasSubmenu
          disabled={userPlaylists.length === 0}
          icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>}
        />
        {showPlaylists && userPlaylists.length > 0 && (
          <div
            className={`absolute top-0 min-w-[190px] bg-[#282828] border border-[#3a3a3a] rounded-lg shadow-2xl py-1.5 px-1 z-50 ${
              pos.x + 220 + 190 > window.innerWidth ? 'right-full mr-1' : 'left-full ml-1'
            }`}
          >
            {userPlaylists.map((pl: Playlist) => (
              <button
                key={pl.id}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  handleAddToPlaylist(pl.id!, pl.name)
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-[#e0e0e0] hover:text-white hover:bg-[#3a3a3a] rounded-md text-left transition-colors cursor-pointer"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-[#535353] flex-shrink-0">
                  <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                </svg>
                <span className="truncate flex-1">{pl.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <MenuItem
        label={track.liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
        onClick={handleToggleLike}
        icon={<svg viewBox="0 0 24 24" fill={track.liked ? '#1DB954' : 'currentColor'}><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>}
      />

      {onRemoveFromPlaylist && track.id && (
        <MenuItem
          label="Remove from this playlist"
          danger
          onClick={() => {
            onRemoveFromPlaylist(track.id!)
            onClose()
          }}
          icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 13H5v-2h14v2z"/></svg>}
        />
      )}

      {track.sourceVideoId && (
        <MenuItem
          label="Find related songs"
          onClick={() => {
            navigate(`/download?seedVideoId=${encodeURIComponent(track.sourceVideoId!)}&seedTitle=${encodeURIComponent(track.title)}`)
            onClose()
          }}
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
          }
        />
      )}

      <Divider />

      {onEditMetadata && (
        <MenuItem
          label="Edit metadata"
          onClick={() => { onEditMetadata(track); onClose() }}
          icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>}
        />
      )}

      <MenuItem
        label="Show in folder"
        onClick={handleShowInFolder}
        icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z"/></svg>}
      />

      <Divider />

      <MenuItem
        label="Remove from library"
        onClick={handleRemoveFromLibrary}
        danger
        icon={<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>}
      />
    </div>,
    document.body
  )
}

export function GlobalContextMenu(): React.JSX.Element | null {
  const { isOpen, track, position, options, closeContextMenu } = useContextMenuStore()

  if (!isOpen || !track) return null

  return (
    <ContextMenu
      track={track}
      position={position}
      onClose={closeContextMenu}
      onEditMetadata={options?.onEditMetadata}
      onTrackUpdated={options?.onTrackUpdated}
      onRemoveFromPlaylist={options?.onRemoveFromPlaylist}
    />
  )
}

