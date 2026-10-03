import { create } from 'zustand'
import type { Track } from '../types'

interface SelectionState {
  selectedIds: Set<number>
  isSelecting: boolean
  // Enter selection mode and optionally pre-select a track
  enterSelectionMode: (track?: Track) => void
  exitSelectionMode: () => void
  toggleTrack: (track: Track) => void
  selectAll: (tracks: Track[]) => void
  clearAll: () => void
  isSelected: (id: number) => boolean
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedIds: new Set(),
  isSelecting: false,

  enterSelectionMode: (track?: Track) => {
    const ids = new Set<number>()
    if (track?.id) ids.add(track.id)
    set({ isSelecting: true, selectedIds: ids })
  },

  exitSelectionMode: () => {
    set({ isSelecting: false, selectedIds: new Set() })
  },

  toggleTrack: (track: Track) => {
    if (!track.id) return
    const ids = new Set(get().selectedIds)
    if (ids.has(track.id)) ids.delete(track.id)
    else ids.add(track.id)
    set({ selectedIds: ids })
  },

  selectAll: (tracks: Track[]) => {
    const ids = new Set(tracks.filter((t) => t.id).map((t) => t.id!))
    set({ selectedIds: ids })
  },

  clearAll: () => {
    set({ selectedIds: new Set() })
  },

  isSelected: (id: number) => get().selectedIds.has(id),
}))