import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useLibraryStore } from '../stores/libraryStore'
import { usePlayerStore } from '../stores/playerStore'
import { useSelectionStore } from '../stores/selectionStore'
import { ArtworkCell } from '../components/ArtworkCell'
import { ContextMenu, type ContextMenuPosition } from '../components/ContextMenu'
import { EditMetadataModal } from '../components/EditMetadataModal'
import { BulkActionBar } from '../components/BulkActionBar'
import type { Track } from '../types'

function formatDuration(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

type SortKey = 'title' | 'artist' | 'album' | 'duration'

export function SongsView(): React.JSX.Element {
  const { tracks, loadLibrary } = useLibraryStore()
  const { playTrack, currentTrack, isPlaying, togglePlay } = usePlayerStore()
  const { isSelecting, selectedIds, toggleTrack, selectAll, isSelected, exitSelectionMode } = useSelectionStore()
  const [sortKey, setSortKey] = useState<SortKey>('artist')
  const [sortAsc, setSortAsc] = useState(true)

  // Exit selection when leaving this view
  useEffect(() => {
    return () => exitSelectionMode()
  }, [exitSelectionMode])

  useEffect(() => {
    loadLibrary().catch(console.error)
  }, [loadLibrary])

  const [ctxMenu, setCtxMenu] = useState<{ track: Track; pos: ContextMenuPosition } | null>(null)
  const [editTrack, setEditTrack] = useState<Track | null>(null)

  const sorted = useMemo(() => {
    return [...tracks].sort((a, b) => {
      if (sortKey === 'duration') return sortAsc ? a.duration - b.duration : b.duration - a.duration
      const av = a[sortKey] ?? '', bv = b[sortKey] ?? ''
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
  }, [tracks, sortKey, sortAsc])

  const handleSort = (key: SortKey) => {
    if (key === sortKey) setSortAsc((v) => !v)
    else { setSortKey(key); setSortAsc(true) }
  }

  const handleRowClick = (track: Track) => {
    if (isSelecting) {
      toggleTrack(track)
      return
    }
    if (currentTrack?.filePath === track.filePath) togglePlay()
    else playTrack(track, sorted)
  }

  const handleContextMenu = useCallback((e: React.MouseEvent, track: Track) => {
    e.preventDefault()
    if (!isSelecting) {
      setCtxMenu({ track, pos: { x: e.clientX, y: e.clientY } })
    }
  }, [isSelecting])

  const SortArrow = ({ k }: { k: SortKey }) =>
    sortKey === k ? <span className="ml-1 opacity-70">{sortAsc ? '↑' : '↓'}</span> : null

  const allSelected = sorted.length > 0 && sorted.every((t) => t.id && isSelected(t.id))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-8 pt-8 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">All Songs</h1>
          <p className="text-sm text-[#b3b3b3]">
            {tracks.length} tracks
            {isSelecting && (
              <span className="ml-2 text-accent font-medium">
                · {selectedIds.size} selected
              </span>
            )}
          </p>
        </div>
        {isSelecting && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => allSelected ? useSelectionStore.getState().clearAll() : selectAll(sorted)}
              className="text-[12px] text-[#888] hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              {allSelected ? 'Deselect all' : 'Select all'}
            </button>
            <button
              onClick={exitSelectionMode}
              className="text-[12px] text-accent hover:text-accent/80 px-3 py-1.5 rounded-lg hover:bg-accent/10 transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>

      {tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-[#535353] gap-2">
          <p className="text-sm">No tracks in library yet. Add a folder from Home.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-[#121212] z-10">
              <tr className="text-[#b3b3b3] text-left border-b border-[#282828]">
                {isSelecting && (
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => allSelected ? useSelectionStore.getState().clearAll() : selectAll(sorted)}
                      className="w-4 h-4 accent-[var(--accent)] cursor-pointer rounded"
                    />
                  </th>
                )}
                <th className="px-4 py-3 w-10 font-normal">#</th>
                <th className="px-4 py-3 font-normal cursor-pointer hover:text-white select-none" onClick={() => handleSort('title')}>
                  Title <SortArrow k="title" />
                </th>
                <th className="px-4 py-3 font-normal cursor-pointer hover:text-white select-none" onClick={() => handleSort('artist')}>
                  Artist <SortArrow k="artist" />
                </th>
                <th className="px-4 py-3 font-normal cursor-pointer hover:text-white select-none" onClick={() => handleSort('album')}>
                  Album <SortArrow k="album" />
                </th>
                <th className="px-4 py-3 font-normal cursor-pointer hover:text-white select-none text-right w-20" onClick={() => handleSort('duration')}>
                  <SortArrow k="duration" />Time
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((track, i) => {
                const isActive = currentTrack?.filePath === track.filePath
                const selected = track.id ? isSelected(track.id) : false
                return (
                  <tr
                    key={track.filePath}
                    onClick={() => handleRowClick(track)}
                    onContextMenu={(e) => handleContextMenu(e, track)}
                    className={`group cursor-pointer border-b border-[#282828]/50 transition-colors ${
                      selected
                        ? 'bg-accent/10 hover:bg-accent/15'
                        : isActive
                        ? 'text-accent hover:bg-[#282828]'
                        : 'text-white hover:bg-[#282828]'
                    }`}
                  >
                    {isSelecting && (
                      <td className="px-4 py-2.5 w-10" onClick={(e) => { e.stopPropagation(); toggleTrack(track) }}>
                        <input
                          type="checkbox"
                          checked={selected}
                          readOnly
                          className="w-4 h-4 accent-[var(--accent)] cursor-pointer rounded pointer-events-none"
                        />
                      </td>
                    )}
                    <td className="px-4 py-2.5 text-[#b3b3b3] w-10">
                      {isActive && isPlaying
                        ? <span className="text-accent text-xs">▶</span>
                        : <span>{i + 1}</span>
                      }
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <ArtworkCell
                          artworkPath={track.artworkPath}
                          seed={track.title}
                          className="w-10 h-10 rounded text-sm flex-shrink-0"
                        />
                        <div className="min-w-0">
                          <span className="truncate max-w-[200px] block">{track.title}</span>
                          {track.liked && <span className="text-accent text-[10px]">♥</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[#b3b3b3] truncate max-w-[160px]">{track.artist}</td>
                    <td className="px-4 py-2.5 text-[#b3b3b3] truncate max-w-[160px]">{track.album}</td>
                    <td className="px-4 py-2.5 text-[#b3b3b3] text-right tabular-nums">{formatDuration(track.duration)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <BulkActionBar onTrackListUpdated={() => loadLibrary()} />

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          track={ctxMenu.track}
          position={ctxMenu.pos}
          onClose={() => setCtxMenu(null)}
          onEditMetadata={(t) => setEditTrack(t)}
          onTrackUpdated={() => loadLibrary()}
        />
      )}

      {/* Edit Metadata Modal */}
      {editTrack && (
        <EditMetadataModal
          track={editTrack}
          onClose={() => setEditTrack(null)}
          onSaved={() => setEditTrack(null)}
        />
      )}
    </div>
  )
}