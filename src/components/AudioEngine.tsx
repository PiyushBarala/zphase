import { useEffect, useRef, useCallback } from 'react'
import { usePlayerStore, persistPlayerSession } from '../stores/playerStore'
import { useEqualizerStore, EQ_BANDS } from '../stores/equalizerStore'

/**
 * Module-level reference to the <audio> element.
 * seekAudio() is the ONE AND ONLY way to set audio.currentTime from outside.
 * Nothing else touches it — this eliminates all race conditions.
 */
let _audioEl: HTMLAudioElement | null = null

// ── Web Audio API EQ chain ─────────────────────────────────────────
// Module-level so the chain persists across re-renders
let _audioCtx: AudioContext | null = null
let _sourceNode: MediaElementAudioSourceNode | null = null
let _filterNodes: BiquadFilterNode[] = []
let _gainNode: GainNode | null = null
let _isConnected = false

/**
 * Initialize the Web Audio API EQ chain for the given audio element.
 * Creates AudioContext → MediaElementSource → 10 BiquadFilters → GainNode → destination.
 * Safe to call multiple times — returns immediately if already connected.
 */
export function initAudioContext(audio: HTMLAudioElement): void {
  if (_isConnected && _sourceNode) return

  try {
    if (!_audioCtx) {
      _audioCtx = new AudioContext()
    }

    // Resume context if suspended (browser autoplay policy)
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {})
    }

    // Only create source once per audio element to avoid InvalidStateError
    if (!_sourceNode) {
      _sourceNode = _audioCtx.createMediaElementSource(audio)
    }

    // Build filter chain
    _filterNodes = EQ_BANDS.map((band) => {
      const filter = _audioCtx!.createBiquadFilter()
      filter.type = band.type
      filter.frequency.value = band.freq
      filter.Q.value = 1.0
      filter.gain.value = 0
      return filter
    })

    // Master gain node (for EQ bypass: when disabled we set all gains to 0)
    _gainNode = _audioCtx.createGain()
    _gainNode.gain.value = 1

    // Chain: source → filter[0] → filter[1] → ... → filter[9] → gain → destination
    let prev: AudioNode = _sourceNode
    for (const filter of _filterNodes) {
      prev.connect(filter)
      prev = filter
    }
    prev.connect(_gainNode)
    _gainNode.connect(_audioCtx.destination)

    _isConnected = true
    console.log('[AudioEngine] Web Audio EQ chain initialized')
  } catch (e) {
    console.warn('[AudioEngine] Failed to initialize Web Audio EQ chain:', e)
  }
}

/**
 * Apply equalizer gains to the filter chain.
 * @param gains  Array of 10 gain values in dB
 * @param enabled  When false, all gains are bypassed (set to 0)
 */
export function applyEqGains(gains: number[], enabled: boolean): void {
  if (!_isConnected || _filterNodes.length === 0) return
  for (let i = 0; i < _filterNodes.length; i++) {
    try {
      _filterNodes[i].gain.value = enabled ? (gains[i] ?? 0) : 0
    } catch {}
  }
}

/**
 * Imperatively seek the audio element. Call this from:
 * - NowPlayingBar seek bar (on pointer up)
 * - NowPlayingBar prev button (restart case)
 * - App.tsx keyboard shortcuts (Arrow keys)
 * - useMiniPlayerCommands (when mini player sends a seek command)
 * - MediaSession seekto / seekbackward / seekforward
 *
 * Bypasses Zustand entirely. onTimeUpdate will update seekPosition for
 * display shortly after, with zero risk of feedback.
 */
export function seekAudio(position: number): void {
  const target = Math.max(0, position)
  if (_audioEl) {
    try {
      _audioEl.currentTime = target
    } catch (e) {
      console.error('[AudioEngine] Seek error:', e)
    }
  }
  usePlayerStore.getState().setSeek(target)
  persistPlayerSession(usePlayerStore.getState())

  if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession && _audioEl) {
    try {
      if (_audioEl.duration && !isNaN(_audioEl.duration) && isFinite(_audioEl.duration)) {
        navigator.mediaSession.setPositionState({
          duration: _audioEl.duration,
          playbackRate: _audioEl.playbackRate || 1,
          position: Math.min(target, _audioEl.duration),
        })
      }
    } catch {}
  }
}

/**
 * Invisible component that owns the HTML5 <audio> element and integrates
 * with Windows 11 System Media Transport Controls (SMTC), Bluetooth headsets,
 * and hardware media keys via navigator.mediaSession.
 *
 * Data flow:
 *   audio element ──► onTimeUpdate ──► store.seekPosition ──► UI (display only)
 *   UI drag / keyboard ──► seekAudio() ──► audio element  (no store roundtrip)
 *   Hardware / Bluetooth / SMTC ──► mediaSession / audio events ──► store.isPlaying
 *   EQ store ──► applyEqGains() ──► BiquadFilterNode chain ──► audio output
 */
export function AudioEngine(): null {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const initialSeekAppliedRef = useRef(false)
  const lastPersistTimeRef = useRef(0)

  // Create the audio element once and publish the module-level ref
  if (!audioRef.current) {
    audioRef.current = new Audio()
    audioRef.current.preload = 'metadata'
  }
  _audioEl = audioRef.current
  const audio = audioRef.current

  const {
    currentTrack,
    isPlaying,
    volume,
    isMuted,
    repeat,
    next,
    prev,
    setSeek,
    setDuration,
  } = usePlayerStore()

  const { gains, enabled } = useEqualizerStore()

  // ── Initialize Web Audio EQ chain once ──────────────────────────
  useEffect(() => {
    // Initialize after first user interaction to satisfy browser autoplay policy
    const initOnInteraction = () => {
      initAudioContext(audio)
      // Apply saved EQ settings immediately
      const { gains: savedGains, enabled: savedEnabled } = useEqualizerStore.getState()
      applyEqGains(savedGains, savedEnabled)
    }

    // Try to init immediately (works if context was already unlocked)
    initAudioContext(audio)
    applyEqGains(useEqualizerStore.getState().gains, useEqualizerStore.getState().enabled)

    // Also init on first interaction in case autoplay policy blocked it
    window.addEventListener('click', initOnInteraction, { once: true })
    window.addEventListener('keydown', initOnInteraction, { once: true })

    return () => {
      window.removeEventListener('click', initOnInteraction)
      window.removeEventListener('keydown', initOnInteraction)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Apply EQ gains whenever store changes ────────────────────────
  useEffect(() => {
    applyEqGains(gains, enabled)
  }, [gains, enabled])

  // ── Track change ────────────────────────────────────────────────
  useEffect(() => {
    if (!currentTrack) return
    const filePath = currentTrack.filePath.replace(/\\/g, '/')
    const mediaUrl = 'lokal://media/' + filePath
    if (audio.src !== mediaUrl) {
      audio.src = mediaUrl
      audio.load()
      // audio.currentTime resets to 0 automatically on load — no effect needed
    }
  }, [currentTrack?.filePath])

  // ── Play / pause sync to audio element ──────────────────────────
  useEffect(() => {
    if (isPlaying) {
      if (audio.paused) {
        // Resume AudioContext if suspended (user interaction happened)
        if (_audioCtx && _audioCtx.state === 'suspended') {
          _audioCtx.resume().catch(() => {})
        }
        audio.play().catch(() => {})
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    } else {
      if (!audio.paused) {
        audio.pause()
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    }
  }, [isPlaying, currentTrack?.filePath])

  // ── Volume / mute ─────────────────────────────────────────────────
  useEffect(() => {
    audio.volume = isMuted ? 0 : volume
  }, [volume, isMuted])

  // ── Repeat ───────────────────────────────────────────────────────
  useEffect(() => {
    audio.loop = repeat === 'one'
  }, [repeat])

  // ── MediaSession Metadata (Windows SMTC, Bluetooth info) ─────────
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    if (currentTrack) {
      const artworkUrl = currentTrack.artworkPath
        ? 'lokal://media/' + currentTrack.artworkPath.replace(/\\/g, '/')
        : undefined

      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || 'Unknown Title',
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'Z Phase',
        artwork: artworkUrl
          ? [
              { src: artworkUrl, sizes: '96x96', type: 'image/png' },
              { src: artworkUrl, sizes: '128x128', type: 'image/png' },
              { src: artworkUrl, sizes: '192x192', type: 'image/png' },
              { src: artworkUrl, sizes: '256x256', type: 'image/png' },
              { src: artworkUrl, sizes: '384x384', type: 'image/png' },
              { src: artworkUrl, sizes: '512x512', type: 'image/png' },
            ]
          : [],
      })
    } else {
      navigator.mediaSession.metadata = null
    }
  }, [currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.artworkPath])

  // ── MediaSession Action Handlers (Bluetooth buttons, Windows Action Center) ──
  useEffect(() => {
    if (!('mediaSession' in navigator)) return

    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => {
        usePlayerStore.getState().play()
      },
      pause: () => {
        usePlayerStore.getState().pause()
      },
      previoustrack: () => {
        const store = usePlayerStore.getState()
        if (store.seekPosition > 3) {
          seekAudio(0)
        } else {
          store.prev()
        }
      },
      nexttrack: () => {
        usePlayerStore.getState().next()
      },
      seekto: (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null) {
          seekAudio(details.seekTime)
        }
      },
      seekbackward: (details) => {
        const skip = details.seekOffset || 10
        seekAudio(Math.max(audio.currentTime - skip, 0))
      },
      seekforward: (details) => {
        const skip = details.seekOffset || 10
        seekAudio(Math.min(audio.currentTime + skip, audio.duration || 0))
      },
      stop: () => {
        audio.pause()
        usePlayerStore.getState().pause()
        seekAudio(0)
      },
    }

    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler)
      } catch (e) {
        console.warn(`[AudioEngine] Failed to register mediaSession handler for ${action}:`, e)
      }
    }

    return () => {
      for (const action of Object.keys(handlers)) {
        try {
          navigator.mediaSession.setActionHandler(action as MediaSessionAction, null)
        } catch {}
      }
    }
  }, [])

  // ── Audio event listeners (Two-way sync with hardware & Windows SMTC) ──
  useEffect(() => {
    const updatePositionState = () => {
      if ('mediaSession' in navigator && 'setPositionState' in navigator.mediaSession) {
        try {
          if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              playbackRate: audio.playbackRate || 1,
              position: Math.min(audio.currentTime, audio.duration),
            })
          }
        } catch {}
      }
    }

    const onLoadedMetadata = () => {
      setDuration(audio.duration || 0)
      updatePositionState()

      // Restore seek position and resume playback on startup if restored session exists
      if (!initialSeekAppliedRef.current) {
        initialSeekAppliedRef.current = true
        const initialSeek = usePlayerStore.getState().seekPosition
        if (initialSeek > 0 && initialSeek < (audio.duration || 999999) - 2) {
          audio.currentTime = initialSeek
        }
        if (usePlayerStore.getState().isPlaying && audio.paused) {
          audio.play().catch(() => {})
        }
      }
    }

    const onTimeUpdate = () => {
      setSeek(audio.currentTime)
      updatePositionState()

      // Periodically persist session every 2 seconds during playback
      const now = Date.now()
      if (now - lastPersistTimeRef.current > 2000) {
        lastPersistTimeRef.current = now
        persistPlayerSession(usePlayerStore.getState())
      }
    }

    const onDurationChange = () => {
      setDuration(audio.duration || 0)
      updatePositionState()
    }

    const onEnded = () => {
      if (repeat !== 'one') next()
    }

    // When hardware/Bluetooth or Windows pauses/plays the audio element directly,
    // sync Zustand store immediately so UI reflects the true playback state
    const onPlay = () => {
      if (!usePlayerStore.getState().isPlaying) {
        usePlayerStore.setState({ isPlaying: true })
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    }

    const onPause = () => {
      if (usePlayerStore.getState().isPlaying) {
        usePlayerStore.setState({ isPlaying: false })
      }
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
    }
  }, [repeat, next, setSeek, setDuration])

  // Persist session before page/window unloads
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistPlayerSession(usePlayerStore.getState())
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [])

  return null
}
