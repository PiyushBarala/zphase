import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

// ── Setting types ──────────────────────────────────────────────────────────
export type ArtworkShape = 'square' | 'rounded' | 'circle'
export type AccentColor = 'green' | 'purple' | 'blue' | 'pink' | 'orange'

export interface AppSettings {
  artworkShape: ArtworkShape
  expandedBlur: number       // 0–20 (px of blur in expanded now-playing bg)
  accentColor: AccentColor
  autoStartOnLogin: boolean
}

const DEFAULTS: AppSettings = {
  artworkShape: 'rounded',
  expandedBlur: 12,
  accentColor: 'green',
  autoStartOnLogin: false,
}

// CSS custom properties for each accent color
export const ACCENT_COLORS: Record<AccentColor, { hex: string; hover: string; label: string }> = {
  green:  { hex: '#1db954', hover: '#1ed760', label: 'Z Phase Green' },
  purple: { hex: '#9b59f5', hover: '#ab6bf5', label: 'Purple' },
  blue:   { hex: '#2196f3', hover: '#42a5f5', label: 'Blue' },
  pink:   { hex: '#e91e8c', hover: '#f06292', label: 'Pink' },
  orange: { hex: '#ff6d00', hover: '#ff8c00', label: 'Orange' },
}

// ── Context ────────────────────────────────────────────────────────────────
interface AppSettingsContextValue {
  settings: AppSettings
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void
}

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: DEFAULTS,
  updateSetting: () => {},
})

export function useAppSettings() {
  return useContext(AppSettingsContext)
}

// ── Apply CSS custom properties for accent color ───────────────────────────
function applyAccentColor(color: AccentColor) {
  const def = ACCENT_COLORS[color]
  document.documentElement.style.setProperty('--accent', def.hex)
  document.documentElement.style.setProperty('--accent-hover', def.hover)
}

// ── Provider ───────────────────────────────────────────────────────────────
export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS)

  // Load all settings from the Electron settings store on mount
  useEffect(() => {
    const keys: (keyof AppSettings)[] = ['artworkShape', 'expandedBlur', 'accentColor', 'autoStartOnLogin']
    Promise.all(
      keys.map((k) => window.lokal?.settings?.get(`ui.${k}`).catch(() => null))
    ).then((values) => {
      const loaded = { ...DEFAULTS }
      keys.forEach((k, i) => {
        if (values[i] !== null && values[i] !== undefined) {
          ;(loaded as Record<string, unknown>)[k] = values[i]
        }
      })
      setSettings(loaded)
      applyAccentColor(loaded.accentColor)
    }).catch(() => {
      applyAccentColor(DEFAULTS.accentColor)
    })
  }, [])

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      // Persist to Electron settings store
      window.lokal?.settings?.set(`ui.${key}`, value).catch(() => {})
      // Apply accent color immediately
      if (key === 'accentColor') applyAccentColor(value as AccentColor)
      return next
    })
  }, [])

  return (
    <AppSettingsContext.Provider value={{ settings, updateSetting }}>
      {children}
    </AppSettingsContext.Provider>
  )
}
