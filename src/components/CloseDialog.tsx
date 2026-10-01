import React, { useEffect, useState } from 'react'

const ZPhaseMark = () => (
  <div className="relative flex-shrink-0">
    <div className="absolute inset-0 rounded-full bg-accent/20 blur-xl scale-150 animate-pulse" />
    <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-accent/30 to-accent/10 border border-accent/30 flex items-center justify-center shadow-lg shadow-accent/20">
      <svg viewBox="0 0 24 24" fill="none" width="28" height="28">
        <path
          d="M6 6h12L6 18h12"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-accent"
        />
      </svg>
    </div>
  </div>
)

const MusicPulse = () => (
  <div className="flex items-end gap-0.5 h-4">
    {[1, 2, 3].map((i) => (
      <div
        key={i}
        className="w-0.5 bg-accent rounded-full animate-equalizer"
        style={{ animationDelay: `${i * 0.15}s`, height: `${8 + i * 3}px` }}
      />
    ))}
  </div>
)

interface CloseDialogProps {
  onDismiss: () => void
}

export function CloseDialog({ onDismiss }: CloseDialogProps): React.JSX.Element {
  const [visible, setVisible] = useState(false)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  const respond = (choice: 'quit' | 'tray') => {
    setExiting(true)
    setTimeout(() => {
      window.lokal.window.closeResponse?.(choice)
      onDismiss()
    }, 200)
  }

  return (
    <div
      className={`fixed inset-0 z-[500] flex items-center justify-center transition-all duration-200 ${
        visible && !exiting ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onDismiss}
      />

      <div
        className={`relative w-[400px] bg-[#181818] border border-white/10 rounded-2xl shadow-2xl overflow-hidden transition-all duration-200 ${
          visible && !exiting ? 'scale-100 translate-y-0' : 'scale-95 translate-y-3'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        <div className="px-6 pt-6 pb-5 flex items-start gap-4">
          <ZPhaseMark />
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-[15px] font-bold text-white tracking-tight">Close Z Phase?</h2>
            <p className="text-[12.5px] text-[#888] mt-1.5 leading-relaxed">
              Music can keep playing. Pick what happens next.
            </p>
          </div>
        </div>

        <div className="h-px bg-white/5 mx-6" />

        <div className="px-4 py-4 flex flex-col gap-2.5">

          <button
            onClick={() => respond('tray')}
            className="group relative w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-accent/10 hover:bg-accent/[0.18] border border-accent/20 hover:border-accent/40 transition-all duration-150 text-left active:scale-[0.99]"
          >
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-gradient-to-r from-accent/5 to-transparent" />
            <div className="relative flex-shrink-0 w-9 h-9 rounded-lg bg-accent/15 border border-accent/20 flex items-center justify-center">
              <MusicPulse />
            </div>
            <div className="relative flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-accent leading-tight">
                Keep Playing in Background
              </p>
              <p className="text-[11.5px] text-[#666] mt-0.5">Z Phase stays in the system tray</p>
            </div>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"
              className="relative flex-shrink-0 text-accent/50 group-hover:text-accent/80 group-hover:translate-x-0.5 transition-all duration-150">
              <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
            </svg>
          </button>

          <button
            onClick={() => respond('quit')}
            className="group w-full flex items-center gap-4 px-4 py-3.5 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/5 hover:border-white/10 transition-all duration-150 text-left active:scale-[0.99]"
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-white/5 border border-white/8 flex items-center justify-center text-[#888] group-hover:text-[#aaa] transition-colors">
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-[#ccc] group-hover:text-white leading-tight transition-colors">
                Quit Z Phase
              </p>
              <p className="text-[11.5px] text-[#555] mt-0.5">Stop music and exit completely</p>
            </div>
            <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"
              className="flex-shrink-0 text-[#444] group-hover:text-[#666] group-hover:translate-x-0.5 transition-all duration-150">
              <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" />
            </svg>
          </button>
        </div>

        <div className="px-6 pb-5 flex items-center justify-between">
          <span className="text-[11px] text-[#444]">
            Press <kbd className="px-1 py-0.5 text-[10px] bg-white/5 rounded border border-white/10 font-mono">Esc</kbd> to cancel
          </span>
          <button
            onClick={onDismiss}
            className="text-[11px] text-[#555] hover:text-[#888] transition-colors"
          >
            Cancel
          </button>
        </div>

        <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      </div>
    </div>
  )
}