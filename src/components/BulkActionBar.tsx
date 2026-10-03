import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSelectionStore } from '../stores/selectionStore'
import { useLibraryStore } from '../stores/libraryStore'
import { showConfirm } from './ConfirmDialog'
import type { Playlist } from '../types'

// ── Playlist Picker Modal ─────────────────────────────────────────
function PlaylistPickerModal({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (playlist: Playlist) => void
}): React.JSX.Element {
  const { playlists } = useLibraryStore()
  const userPlaylists = playlists.filter((p) => p.id !== 1)

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[320px] bg-[#1e1e1e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden animate-in">
        <div className="px-5 pt-5 pb-3 border-b border-white/5">
          <h3 className="text-[14px] font-bold text-white">Add to playlist</h3>
          <p className="text-[12px] text-[#888] mt-0.5">Choose a playlist for the selected songs</p>
        </div>
        <div className="max-h-[260px] overflow-y-auto py-2">
          {userPlaylists.length === 0 ? (
            <p className="text-center text-[#555] text-sm py-6">No playlists yet</p>
          ) : (
            userPlaylists.map((pl) => (
              <button
                key={pl.id}
                onClick={() => onPick(pl)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-md bg-accent/15 border border-accent/20 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-accent">
                    <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
                  </svg>
                </div>
                <span className="flex-1 text-[13px] text-[#e0e0e0] truncate">{pl.name}</span>
              </button>
            ))
          )}
        </div>
        <div className="px-4 py-3 border-t border-white/5 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] text-[#888] hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Bulk Action Bar ───────────────────────────────────────────────
interface BulkActionBarProps {
  onTrackListUpdated?: () => void
  currentPlaylistId?: number
}

export function BulkActionBar({ onTrackListUpdated, currentPlaylistId }: BulkActionBarProps): React.JSX.Element | null {
  const { isSelecting, selectedIds, exitSelectionMode, clearAll } = useSelectionStore()
  const { loadLibrary } = useLibraryStore()
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false)
  const [isWorking, setIsWorking] = useState(false)

  if (!isSelecting) return null

  const count = selectedIds.size
  const ids = Array.from(selectedIds)

  const handleAddToPlaylist = async (playlist: Playlist) => {
    setShowPlaylistPicker(false)
    if (!playlist.id || ids.length === 0) return
    setIsWorking(true)
    let added = 0
    for (const id of ids) {
      try {
        await window.lokal.db.addTrackToPlaylist(playlist.id, id)
        added++
      } catch {}
    }
    setIsWorking(false)
    window.dispatchEvent(new CustomEvent('lokal:toast', {
      detail: `Added ${added} song${added !== 1 ? 's' : ''} to "${playlist.name}"`,
    }))
    exitSelectionMode()
  }

  const handleRemoveFromPlaylist = async () => {
    if (!currentPlaylistId || ids.length === 0) return
    const confirmed = await showConfirm({
      title: 'Remove from playlist',
      message: `Remove ${count} song${count !== 1 ? 's' : ''} from this playlist?`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    setIsWorking(true)
    for (const id of ids) {
      try { await window.lokal.db.removeTrackFromPlaylist(currentPlaylistId, id) } catch {}
    }
    setIsWorking(false)
    onTrackListUpdated?.()
    exitSelectionMode()
    window.dispatchEvent(new CustomEvent('lokal:toast', {
      detail: `Removed ${count} song${count !== 1 ? 's' : ''} from playlist`,
    }))
  }

  const handleRemoveFromLibrary = async () => {
    if (ids.length === 0) return
    const confirmed = await showConfirm({
      title: 'Remove from library',
      message: `Remove ${count} song${count !== 1 ? 's' : ''} from your library? This cannot be undone.`,
      confirmLabel: 'Remove',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    setIsWorking(true)
    for (const id of ids) {
      try { await window.lokal.db.removeTrack(id) } catch {}
    }
    setIsWorking(false)
    await loadLibrary()
    onTrackListUpdated?.()
    exitSelectionMode()
    window.dispatchEvent(new CustomEvent('lokal:toast', {
      detail: `Removed ${count} song${count !== 1 ? 's' : ''} from library`,
    }))
  }

  const handleDeleteFromDevice = async () => {
    if (ids.length === 0) return
    const confirmed = await showConfirm({
      title: 'Delete permanently',
      message: `Permanently delete ${count} song${count !== 1 ? 's' : ''} from your device? This cannot be undone.`,
      confirmLabel: 'Delete forever',
      cancelLabel: 'Cancel',
      danger: true,
    })
    if (!confirmed) return
    setIsWorking(true)

    // Get file paths first, then delete
    let deleted = 0
    const allTracks = await window.lokal.db.getTracks()
    for (const id of ids) {
      try {
        const track = allTracks.find((t) => t.id === id)
        await window.lokal.db.removeTrack(id)
        if (track?.filePath) {
          await window.lokal.shell.deleteFile(track.filePath).catch(() => {})
        }
        deleted++
      } catch {}
    }
    setIsWorking(false)
    await loadLibrary()
    onTrackListUpdated?.()
    exitSelectionMode()
    window.dispatchEvent(new CustomEvent('lokal:toast', {
      detail: `Deleted ${deleted} song${deleted !== 1 ? 's' : ''} from device`,
    }))
  }

  return createPortal(
    <>
      {showPlaylistPicker && (
        <PlaylistPickerModal
          onClose={() => setShowPlaylistPicker(false)}
          onPick={handleAddToPlaylist}
        />
      )}

      {/* Floating action bar */}
      <div className="fixed bottom-[88px] left-1/2 -translate-x-1/2 z-[200] flex items-center gap-2 px-3 py-2.5 bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl animate-in">
        {/* Selection count badge */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-accent/15 border border-accent/25 rounded-xl mr-1">
          <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
          <span className="text-[13px] font-bold text-accent tabular-nums">
            {count} selected
          </span>
        </div>

        {/* Add to playlist */}
        <ActionBtn
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/>
            </svg>
          }
          label="Add to playlist"
          disabled={count === 0 || isWorking}
          onClick={() => setShowPlaylistPicker(true)}
        />

        {/* Remove from playlist (only when inside a playlist) */}
        {currentPlaylistId && currentPlaylistId !== 1 && (
          <ActionBtn
            icon={
              <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
                <path d="M19 13H5v-2h14v2z"/>
              </svg>
            }
            label="Remove from playlist"
            danger
            disabled={count === 0 || isWorking}
            onClick={handleRemoveFromPlaylist}
          />
        )}

        {/* Remove from library */}
        <ActionBtn
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
            </svg>
          }
          label="Remove from library"
          danger
          disabled={count === 0 || isWorking}
          onClick={handleRemoveFromLibrary}
        />

        {/* Delete from device */}
        <ActionBtn
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M20 6h-2.18c.07-.46.18-.92.18-1.4C18 2.06 15.96 0 13.4 0c-1.36 0-2.57.56-3.4 1.47C9.17.56 7.96 0 6.6 0 4.04 0 2 2.06 2 4.6c0 .48.11.94.18 1.4H0v2h20V6zm-7.6-4c1.29 0 2.2.91 2.2 2.2 0 .45-.1.89-.26 1.29C14 5.18 13.5 5 13 5h-1.53c-.17-.41-.27-.86-.27-1.32C11.2 2.39 12.11 2 12.4 2zM8 22h8c1.1 0 2-.9 2-2V8H6v12c0 1.1.9 2 2 2z"/>
            </svg>
          }
          label="Delete from device"
          danger
          disabled={count === 0 || isWorking}
          onClick={handleDeleteFromDevice}
        />

        {/* Divider */}
        <div className="w-px h-6 bg-white/10 mx-1" />

        {/* Select all / clear */}
        <ActionBtn
          icon={
            <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15">
              <path d="M18 7l-1.41-1.41-6.34 6.34-2.83-2.83L6 10.5l4.24 4.24L18 7zM3 5H1v16c0 1.1.9 2 2 2h16v-2H3V5z"/>
            </svg>
          }
          label="Clear"
          disabled={isWorking}
          onClick={clearAll}
        />

        {/* Close / exit */}
        <button
          onClick={exitSelectionMode}
          title="Exit selection"
          className="flex items-center justify-center w-8 h-8 rounded-lg text-[#888] hover:text-white hover:bg-white/8 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
          </svg>
        </button>
      </div>
    </>,
    document.body
  )
}

function ActionBtn({
  icon, label, onClick, danger = false, disabled = false,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-all duration-150 active:scale-95 ${
        disabled
          ? 'text-[#444] cursor-not-allowed'
          : danger
          ? 'text-red-400 hover:text-red-300 hover:bg-red-900/25'
          : 'text-[#ccc] hover:text-white hover:bg-white/8'
      }`}
    >
      {icon}
      <span className="hidden sm:inline whitespace-nowrap">{label}</span>
    </button>
  )
}