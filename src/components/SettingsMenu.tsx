import React, { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlayerStore } from '../stores/playerStore'
import { useLibraryStore } from '../stores/libraryStore'
import { seekAudio } from './AudioEngine'
import lokalLogo from '../../public/lokal.png'
import type { UpdateStatus } from '../types'

// ── Zoom management ───────────────────────────────────────────────
let currentZoom = 1.0

export function zoomIn(): void {
  currentZoom = Math.min(1.5, Math.round((currentZoom + 0.1) * 10) / 10)
  document.documentElement.style.zoom = String(currentZoom)
}

export function zoomOut(): void {
  currentZoom = Math.max(0.7, Math.round((currentZoom - 0.1) * 10) / 10)
  document.documentElement.style.zoom = String(currentZoom)
}

export function resetZoom(): void {
  currentZoom = 1.0
  document.documentElement.style.zoom = '1'
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

// ── About Modal ───────────────────────────────────────────────────
function AboutModal({ onClose }: { onClose: () => void }) {
  const [version, setVersion] = useState('...')
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  const [showBugForm, setShowBugForm] = useState(false)
  const [bugEmail, setBugEmail] = useState('')
  const [bugMessage, setBugMessage] = useState('')
  const [bugSubmitting, setBugSubmitting] = useState(false)
  const [bugResult, setBugResult] = useState<'success' | 'error' | null>(null)

  useEffect(() => {
    window.lokal?.updater?.getVersion().then(setVersion).catch(() => {})
    window.lokal?.updater?.getLastStatus().then(setStatus).catch(() => {})

    const unsub = window.lokal?.updater?.onStatus((newStatus) => {
      setStatus(newStatus)
      if (newStatus.type !== 'checking') {
        setIsChecking(false)
      }
    })
    return unsub
  }, [])

  const handleCheckUpdates = async () => {
    setIsChecking(true)
    try {
      await window.lokal?.updater?.checkForUpdates()
    } catch {
      setIsChecking(false)
    }
  }

  const handleStartDownload = async () => {
    setStatus((prev) => ({
      type: 'downloading',
      currentVersion: version,
      version: prev?.version || 'latest',
      percent: 0,
      message: 'Starting download in background...',
    }))
    try {
      await window.lokal?.updater?.downloadUpdate()
    } catch (e) {
      console.error('Download error:', e)
    }
  }

  const handleSkipUpdate = async (ver?: string) => {
    try {
      await window.lokal?.updater?.skipUpdate(ver)
      setStatus({
        type: 'idle',
        currentVersion: version,
        message: 'Update skipped.',
      })
    } catch (e) {
      console.error('Skip error:', e)
    }
  }

  const handleInstall = () => {
    window.lokal?.updater?.quitAndInstall()
  }

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#242424] border border-white/15 rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col items-center text-center relative animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[#b3b3b3] hover:text-white transition-colors"
          title="Close"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>

        <img
          src={lokalLogo}
          alt="Z Phase"
          className="w-20 h-20 rounded-2xl shadow-xl mb-4 border border-white/10 object-cover"
        />

        <h2 className="text-xl font-bold text-white tracking-tight">Z Phase</h2>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-accent/20 text-accent mt-1 mb-3">
          v{version} (Windows x64)
        </span>

        <p className="text-sm text-[#b3b3b3] leading-relaxed mb-4">
          A local-first offline music player inspired by Spotify desktop, built for your personal music library with online discovery.
        </p>

        {/* ── Auto-Updater Section ── */}
        <div className="w-full bg-[#181818] rounded-xl p-3.5 mb-4 border border-white/10 flex flex-col items-center text-center">
          {status?.type === 'checking' || isChecking ? (
            <div className="flex items-center gap-2 text-xs text-[#b3b3b3] py-1">
              <div className="w-3.5 h-3.5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <span>Checking for updates...</span>
            </div>
          ) : status?.type === 'downloading' ? (
            <div className="w-full space-y-2 py-1">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-1.5 text-white font-medium">
                  <div className="w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <span>Downloading v{status.version || ''}...</span>
                </div>
                <span className="font-mono text-xs font-semibold text-accent">{status.percent ?? 0}%</span>
              </div>

              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent transition-all duration-300 rounded-full shadow-[0_0_8px_rgba(30,215,96,0.6)]"
                  style={{ width: `${Math.min(100, Math.max(0, status.percent ?? 0))}%` }}
                />
              </div>

              <div className="flex justify-between text-[11px] text-[#888] font-mono">
                <span>
                  {status.transferred && status.total
                    ? `${formatBytes(status.transferred)} / ${formatBytes(status.total)}`
                    : status.percent
                    ? `${status.percent}% completed`
                    : 'Downloading...'}
                </span>
                {status.bytesPerSecond ? <span>{formatBytes(status.bytesPerSecond)}/s</span> : null}
              </div>

              <p className="text-[10px] text-[#888] leading-tight text-center pt-0.5">
                Downloading in background. You can close this window and continue listening.
              </p>
            </div>
          ) : status?.type === 'downloaded' ? (
            <div className="w-full flex flex-col items-center gap-2.5 py-1">
              <div className="flex items-center gap-1.5 text-xs text-accent font-semibold">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
                </svg>
                <span>v{status.version} downloaded & ready!</span>
              </div>
              <p className="text-[11px] text-[#b3b3b3]">
                Restart Z Phase now to install the new update.
              </p>
              <button
                onClick={handleInstall}
                className="w-full py-2.5 rounded-lg bg-accent text-black font-bold text-xs hover:bg-accent/90 transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
              >
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z" />
                </svg>
                <span>Restart & Install Now</span>
              </button>
            </div>
          ) : status?.type === 'available' ? (
            <div className="w-full flex flex-col items-center gap-2 py-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-accent">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-accent"></span>
                </span>
                <span>New version available: v{status.version}</span>
              </div>
              <p className="text-[11px] text-[#b3b3b3] leading-normal">
                An update is ready for Z Phase. Download it in the background or skip for now.
              </p>
              <div className="flex items-center gap-2 w-full mt-1">
                <button
                  onClick={() => handleSkipUpdate(status.version)}
                  className="flex-1 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/90 hover:text-white font-medium text-xs transition-all active:scale-95"
                >
                  Skip
                </button>
                <button
                  onClick={handleStartDownload}
                  className="flex-1 py-2 rounded-lg bg-accent text-black font-bold text-xs hover:bg-accent/90 transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                    <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z" />
                  </svg>
                  <span>Download</span>
                </button>
              </div>
            </div>
          ) : status?.type === 'not-available' ? (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5 text-xs text-white/80">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-accent">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
                <span>Up to date</span>
              </div>
              <button
                onClick={handleCheckUpdates}
                className="text-[11px] text-[#b3b3b3] hover:text-white underline transition-colors"
              >
                Check again
              </button>
            </div>
          ) : status?.type === 'error' ? (
            <div className="flex flex-col items-center gap-1.5 w-full">
              <span className="text-[11px] text-red-400">{status.message || 'Check failed'}</span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCheckUpdates}
                  className="text-[11px] text-accent hover:underline font-medium"
                >
                  Retry Check
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleCheckUpdates}
              className="w-full py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium text-xs transition-colors flex items-center justify-center gap-2"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" className="text-[#b3b3b3]">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
              </svg>
              Check for Updates
            </button>
          )}
        </div>

        <div className="w-full space-y-2 mb-5">

          {/* ── Bug Report ── */}
          {!showBugForm ? (
            <button
              onClick={() => { setShowBugForm(true); setBugResult(null) }}
              className="flex items-center gap-3 w-full px-4 py-3 bg-[#181818] hover:bg-[#1f1f1f] border border-white/5 hover:border-white/10 rounded-xl transition-all group text-left"
            >
              <div className="w-7 h-7 rounded-lg bg-[#ff6b6b]/15 flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-[#ff6b6b]">
                  <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 9h-2V5h2v6zm0 4h-2v-2h2v2z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-white group-hover:text-white/90">Report a Bug</p>
                <p className="text-[11px] text-[#555] mt-0.5">Help us improve Z Phase</p>
              </div>
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" className="text-[#444] group-hover:text-[#666] flex-shrink-0">
                <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
              </svg>
            </button>
          ) : bugResult === 'success' ? (
            <div className="w-full px-4 py-4 bg-[#181818] border border-accent/20 rounded-xl flex flex-col items-center gap-2 text-center">
              <div className="w-8 h-8 rounded-full bg-accent/15 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" className="text-accent">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-white">Bug report sent!</p>
              <p className="text-[11px] text-[#666]">Thanks for helping improve Z Phase.</p>
              <button
                onClick={() => { setShowBugForm(false); setBugEmail(''); setBugMessage(''); setBugResult(null) }}
                className="text-[11px] text-accent hover:underline mt-1"
              >Done</button>
            </div>
          ) : (
            <div className="w-full bg-[#181818] border border-white/5 rounded-xl overflow-hidden">
              {/* Form header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13" className="text-[#ff6b6b]">
                    <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 9h-2V5h2v6zm0 4h-2v-2h2v2z" />
                  </svg>
                  <span className="text-xs font-semibold text-white">Report a Bug</span>
                </div>
                <button
                  onClick={() => { setShowBugForm(false); setBugResult(null) }}
                  className="text-[#555] hover:text-[#888] transition-colors"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                </button>
              </div>

              {/* Fields */}
              <div className="px-4 py-3 space-y-2.5">
                <div>
                  <label className="text-[10px] text-[#555] uppercase tracking-wider font-semibold block mb-1">Your email (optional)</label>
                  <input
                    type="email"
                    value={bugEmail}
                    onChange={(e) => setBugEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full bg-[#111] border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#444] focus:outline-none focus:border-accent/50 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#555] uppercase tracking-wider font-semibold block mb-1">What went wrong? *</label>
                  <textarea
                    value={bugMessage}
                    onChange={(e) => setBugMessage(e.target.value)}
                    placeholder="Describe the bug, what you were doing, and what you expected to happen..."
                    rows={4}
                    className="w-full bg-[#111] border border-white/8 rounded-lg px-3 py-1.5 text-xs text-white placeholder-[#444] focus:outline-none focus:border-accent/50 transition-colors resize-none"
                  />
                </div>

                {bugResult === 'error' && (
                  <p className="text-[11px] text-[#ff6b6b]">Failed to send. Please try again.</p>
                )}

                <button
                  disabled={bugSubmitting || !bugMessage.trim()}
                  onClick={async () => {
                    if (!bugMessage.trim()) return
                    setBugSubmitting(true)
                    setBugResult(null)
                    try {
                      const result = await window.lokal.feedback.submit({
                        email: bugEmail,
                        message: bugMessage,
                        version,
                      })
                      setBugResult(result.ok ? 'success' : 'error')
                    } catch {
                      setBugResult('error')
                    } finally {
                      setBugSubmitting(false)
                    }
                  }}
                  className={`w-full py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                    bugSubmitting || !bugMessage.trim()
                      ? 'bg-white/10 text-[#555] cursor-not-allowed'
                      : 'bg-[#ff6b6b] hover:bg-[#ff5555] text-white active:scale-95'
                  }`}
                >
                  {bugSubmitting ? (
                    <><div className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /><span>Sending...</span></>
                  ) : 'Send Bug Report'}
                </button>
              </div>
            </div>
          )}

          {/* GitHub */}
          <a
            href="https://github.com/PiyushBarala/zphase"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 w-full px-4 py-3 bg-[#181818] hover:bg-[#1f1f1f] border border-white/5 hover:border-white/10 rounded-xl transition-all group"
          >
            <div className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-[#ccc]">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
            <div className="flex-1 text-left">
              <p className="text-sm font-semibold text-white group-hover:text-white/90">View Source on GitHub</p>
              <p className="text-[11px] text-[#555] mt-0.5">PiyushBarala/zphase · Open source</p>
            </div>
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" className="text-[#444] group-hover:text-[#666] flex-shrink-0">
              <path d="M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z" />
            </svg>
          </a>
        </div>

        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-full bg-white hover:bg-[#e6e6e6] text-black font-bold text-sm transition-transform active:scale-95"
        >
          Close
        </button>
      </div>
    </div>
  )
}


// ── Icons ─────────────────────────────────────────────────────────
const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12" className="text-[#b3b3b3] ml-auto">
    <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
  </svg>
)

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14" className="text-accent">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>
)

interface SettingsMenuProps {
  onPickFolder: () => void
}

type MenuCategory = 'file' | 'edit' | 'view' | 'playback' | 'help' | null

export function SettingsMenu({ onPickFolder }: SettingsMenuProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<MenuCategory>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    window.lokal?.updater?.getLastStatus().then(setUpdateStatus).catch(() => {})
    const unsub = window.lokal?.updater?.onStatus((st) => {
      setUpdateStatus(st)
      if (st.type === 'downloaded') {
        window.dispatchEvent(
          new CustomEvent('lokal:toast', {
            detail: `✨ Z Phase update ready! Open About to restart & install.`
          })
        )
      }
    })

    const onOpenAbout = () => setShowAbout(true)
    window.addEventListener('lokal:open-about', onOpenAbout)

    return () => {
      unsub?.()
      window.removeEventListener('lokal:open-about', onOpenAbout)
    }
  }, [])

  const {
    isPlaying,
    togglePlay,
    next,
    prev,
    seekPosition,
    duration,
    shuffle,
    toggleShuffle,
    repeat,
    cycleRepeat,
    toggleQueuePanel,
  } = usePlayerStore()

  const { refreshPlaylists } = useLibraryStore()

  // Close menu on click outside
  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setActiveCategory(null)
      }
    }
    window.addEventListener('mousedown', handleClickOutside)
    return () => window.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const closeMenu = () => {
    setIsOpen(false)
    setActiveCategory(null)
  }

  const handleNewPlaylist = async () => {
    closeMenu()
    const name = `My Playlist #${Math.floor(Math.random() * 900 + 100)}`
    const created = await window.lokal.db.createPlaylist(name)
    await refreshPlaylists()
    if (created?.id) {
      navigate(`/playlist/${created.id}`)
    }
  }

  const handleSelectAll = () => {
    closeMenu()
    window.getSelection()?.selectAllChildren(document.body)
  }

  const handleSearchFocus = () => {
    closeMenu()
    navigate('/search')
    setTimeout(() => {
      const input = document.getElementById('top-search-input') as HTMLInputElement | null
      input?.focus()
      input?.select()
    }, 50)
  }

  return (
    <>
      <div className="relative" ref={menuRef}>
        {/* Three dots button */}
        <button
          onClick={() => {
            setIsOpen(!isOpen)
            setActiveCategory(null)
          }}
          className={`relative w-8 h-8 rounded-full flex items-center justify-center transition-colors shadow-sm ${isOpen
            ? 'bg-[#282828] text-white ring-1 ring-white/20'
            : 'bg-[#121212] hover:bg-[#1f1f1f] text-[#b3b3b3] hover:text-white'
            }`}
          title="Menu (Settings, File, Playback)"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
          {updateStatus?.type === 'available' && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent animate-pulse" />
          )}
          {updateStatus?.type === 'downloading' && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent animate-ping" />
          )}
          {updateStatus?.type === 'downloaded' && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent shadow-[0_0_6px_rgba(30,215,96,0.8)]" />
          )}
        </button>

        {/* Root Menu Dropdown */}
        {isOpen && (
          <div className="absolute left-0 top-10 mt-1 z-50 min-w-[150px] bg-[#282828] text-[#e0e0e0] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs font-normal select-none">
            {/* 1. File */}
            <div
              className={`relative px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#333333] hover:text-white ${activeCategory === 'file' ? 'bg-[#333333] text-white' : ''
                }`}
              onMouseEnter={() => setActiveCategory('file')}
            >
              <span>File</span>
              <ChevronRight />

              {/* Submenu: File */}
              {activeCategory === 'file' && (
                <div className="absolute left-full top-0 ml-1 min-w-[210px] bg-[#282828] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs">
                  <div
                    onClick={handleNewPlaylist}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>New Playlist</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+N</span>
                  </div>
                  <div
                    onClick={() => {
                      closeMenu()
                      onPickFolder()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span className="text-accent font-medium">Add Folder…</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+O</span>
                  </div>
                  <div className="border-t border-[#3e3e3e] my-1" />
                  <div
                    onClick={() => {
                      closeMenu()
                      window.lokal.window.close()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer text-[#ff6b6b]"
                  >
                    <span>Exit</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+Shift+Q</span>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Edit */}
            <div
              className={`relative px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#333333] hover:text-white ${activeCategory === 'edit' ? 'bg-[#333333] text-white' : ''
                }`}
              onMouseEnter={() => setActiveCategory('edit')}
            >
              <span>Edit</span>
              <ChevronRight />

              {/* Submenu: Edit */}
              {activeCategory === 'edit' && (
                <div className="absolute left-full top-0 ml-1 min-w-[210px] bg-[#282828] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs">
                  <div
                    onClick={handleSelectAll}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Select All</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+A</span>
                  </div>
                  <div className="border-t border-[#3e3e3e] my-1" />
                  <div
                    onClick={handleSearchFocus}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Search</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+K</span>
                  </div>
                </div>
              )}
            </div>

            {/* 3. View */}
            <div
              className={`relative px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#333333] hover:text-white ${activeCategory === 'view' ? 'bg-[#333333] text-white' : ''
                }`}
              onMouseEnter={() => setActiveCategory('view')}
            >
              <span>View</span>
              <ChevronRight />

              {/* Submenu: View */}
              {activeCategory === 'view' && (
                <div className="absolute left-full top-0 ml-1 min-w-[210px] bg-[#282828] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs">
                  <div
                    onClick={() => {
                      zoomIn()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Zoom In</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+=</span>
                  </div>
                  <div
                    onClick={() => {
                      zoomOut()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Zoom Out</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+-</span>
                  </div>
                  <div
                    onClick={() => {
                      resetZoom()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Reset Zoom</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+0</span>
                  </div>
                  <div className="border-t border-[#3e3e3e] my-1" />
                  <div
                    onClick={() => {
                      closeMenu()
                      toggleQueuePanel()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Toggle Queue</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Ctrl+Q</span>
                  </div>
                  <div
                    onClick={() => {
                      closeMenu()
                      window.lokal.miniplayer.open()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Mini Player</span>
                  </div>
                </div>
              )}
            </div>

            {/* 4. Playback */}
            <div
              className={`relative px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#333333] hover:text-white ${activeCategory === 'playback' ? 'bg-[#333333] text-white' : ''
                }`}
              onMouseEnter={() => setActiveCategory('playback')}
            >
              <span>Playback</span>
              <ChevronRight />

              {/* Submenu: Playback */}
              {activeCategory === 'playback' && (
                <div className="absolute left-full top-0 ml-1 min-w-[220px] bg-[#282828] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs">
                  <div
                    onClick={() => {
                      togglePlay()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>{isPlaying ? 'Pause' : 'Play'}</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Space</span>
                  </div>
                  <div
                    onClick={() => {
                      next()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Next</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Shift+→</span>
                  </div>
                  <div
                    onClick={() => {
                      prev()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Previous</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">Shift+←</span>
                  </div>
                  <div className="border-t border-[#3e3e3e] my-1" />
                  <div
                    onClick={() => {
                      seekAudio(Math.min(seekPosition + 10, duration))
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Seek Forward 10s</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">→</span>
                  </div>
                  <div
                    onClick={() => {
                      seekAudio(Math.max(seekPosition - 10, 0))
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Seek Backward 10s</span>
                    <span className="text-[#888] text-[11px] font-mono ml-4">←</span>
                  </div>
                  <div className="border-t border-[#3e3e3e] my-1" />
                  <div
                    onClick={() => {
                      toggleShuffle()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 flex items-center justify-center">
                        {shuffle && <CheckIcon />}
                      </span>
                      <span>Shuffle</span>
                    </div>
                  </div>
                  <div
                    onClick={() => {
                      cycleRepeat()
                      closeMenu()
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 flex items-center justify-center">
                        {repeat !== 'off' && <CheckIcon />}
                      </span>
                      <span>Repeat ({repeat === 'one' ? 'One' : repeat === 'all' ? 'All' : 'Off'})</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 5. Help */}
            <div
              className={`relative px-3 py-1.5 flex items-center justify-between cursor-pointer hover:bg-[#333333] hover:text-white ${activeCategory === 'help' ? 'bg-[#333333] text-white' : ''
                }`}
              onMouseEnter={() => setActiveCategory('help')}
            >
              <div className="flex items-center gap-2">
                <span>Help</span>
                {(updateStatus?.type === 'available' || updateStatus?.type === 'downloaded') && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse" />
                )}
              </div>
              <ChevronRight />

              {/* Submenu: Help */}
              {activeCategory === 'help' && (
                <div className="absolute left-full top-0 ml-1 min-w-[190px] bg-[#282828] rounded-md shadow-2xl py-1 border border-[#3e3e3e] text-xs">
                  <div
                    onClick={() => {
                      closeMenu()
                      setShowAbout(true)
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>About Z Phase</span>
                  </div>
                  <div
                    onClick={() => {
                      closeMenu()
                      setShowAbout(true)
                      window.lokal?.updater?.checkForUpdates().catch(() => {})
                    }}
                    className="px-3 py-1.5 flex items-center justify-between hover:bg-[#333333] hover:text-white cursor-pointer"
                  >
                    <span>Check for Updates...</span>
                    {updateStatus?.type === 'downloaded' ? (
                      <span className="text-[10px] text-accent font-semibold px-1.5 py-0.5 bg-accent/20 rounded">
                        Ready
                      </span>
                    ) : updateStatus?.type === 'downloading' ? (
                      <span className="text-[10px] text-accent font-semibold px-1.5 py-0.5 bg-accent/20 rounded">
                        {updateStatus.percent ?? 0}%
                      </span>
                    ) : updateStatus?.type === 'available' ? (
                      <span className="text-[10px] text-accent font-semibold px-1.5 py-0.5 bg-accent/20 rounded">
                        New
                      </span>
                    ) : null}
                  </div>

                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </>
  )
}
