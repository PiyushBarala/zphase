<div align="center">

<img src="public/logo.png" alt="Z Phase Music Player" width="120" height="120" style="border-radius:20px" />

# Z Phase — Offline-First Windows Music Player

**A beautiful, open-source local music player for Windows — built like Spotify, but for your personal library.**

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-green.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)](https://github.com/PiyushBarala/zphase/releases)
[![Built with Electron](https://img.shields.io/badge/built%20with-Electron-47848f.svg)](https://electronjs.org)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://reactjs.org)
[![SQLite](https://img.shields.io/badge/database-SQLite-003b57.svg)](https://sqlite.org)

[Download Latest Release](https://github.com/PiyushBarala/zphase/releases) · [Report a Bug](https://github.com/PiyushBarala/zphase/issues) · [Request a Feature](https://github.com/PiyushBarala/zphase/issues)

</div>

---

## What is Z Phase?

**Z Phase** is a free, open-source, offline-first music player for Windows that combines the familiar Spotify-like interface with full local library management. Play your MP3s, FLACs, WAVs and other audio files entirely offline — no subscription, no internet required, no telemetry.

Built with Electron + React + SQLite, Z Phase gives you a premium desktop music experience for your personal collection, with optional online music discovery powered by yt-dlp.

## ✨ Features

### 🎵 Local Music Library
- **Scan & index** your music folders automatically (MP3, FLAC, M4A, WAV, OGG, AAC)
- **SQLite-backed library** — blazing fast search and filtering, fully offline
- **Automatic metadata** extraction: title, artist, album, artwork, year, genre
- **Liked Songs**, **Playlists**, and **Smart library views** (Albums, Artists)
- **Drag-to-reorder** playlist tracks

### 🎚️ 10-Band Persistent Equalizer
- **Persistent 10-band EQ** powered by the Web Audio API
- **14 built-in presets**: Rock, Pop, Dance, Electronic, Jazz, Classical, Vocal, R&B, Hip-Hop, Acoustic, Bass Boost, Treble Boost, Bass & Treble, and Flat
- **Custom preset detection** — automatically shows "Custom" when you tweak a preset
- Settings saved and **restored across restarts**
- **EQ bypass toggle** to instantly A/B compare

### ⬇️ Music Discovery & Download
- **Search YouTube** directly from within Z Phase
- **Download as MP3** with embedded artwork and metadata via yt-dlp
- **Real-time download progress** with speed and ETA
- Downloaded tracks automatically added to your library and Downloads playlist
- Simultaneous multi-download support

### 🎛️ Playback Engine
- HTML5 audio engine with smooth track switching
- **Shuffle, Repeat (one/all), Skip, Seek** controls
- **10-second skip forward/backward** buttons
- **Windows 11 SMTC** integration (system media controls, lock screen)
- **Bluetooth & hardware media key** support
- **Volume control** with mute toggle

### 🪟 Windows-Native Feel
- Custom **frameless window** with native-feel title bar
- **Mini Player** — compact always-on-top window
- **Expanded Now Playing** full-screen view with album art blur
- **System tray** and startup launch support
- Auto-updater with background downloads

### 📚 Library Management
- Edit track metadata (title, artist, album, year, genre)
- Remove tracks from library
- Right-click context menus on all tracks
- Recently played history
- Queue management with drag-to-reorder

---

## 📸 Screenshots

> Coming soon — contributions welcome!

---

## 🚀 Installation

### Download Pre-built Release (Recommended)

1. Go to the [**Releases page**](https://github.com/PiyushBarala/zphase/releases)
2. Download the latest `Z Phase-Setup-x.x.x.exe` installer
3. Run the installer — Z Phase will appear in your Start Menu
4. On first launch, click **Add Folder** to scan your music library

> **Note:** Windows may show a SmartScreen warning since Z Phase is not yet code-signed. Click *More info → Run anyway* to proceed.

### Build from Source

**Prerequisites:** Node.js 18+, Git

```bash
# 1. Clone the repository
git clone https://github.com/PiyushBarala/zphase.git
cd zphase

# 2. Install dependencies
npm install

# 3. Download yt-dlp and ffmpeg (required for music download feature)
# Place yt-dlp.exe and ffmpeg.exe in: resources/bin/

# 4. Start in development mode
npm run dev

# 5. Build the installer
npm run build
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| Shell | [Electron](https://electronjs.org) v28+ |
| UI Framework | [React](https://reactjs.org) 18 + TypeScript |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| Build Tool | [electron-vite](https://electron-vite.github.io) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (SQLite) |
| Metadata | [music-metadata](https://github.com/Borewit/music-metadata) |
| Audio | HTML5 Audio + [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) |
| Downloads | [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [ffmpeg](https://ffmpeg.org) |
| State | [Zustand](https://github.com/pmndrs/zustand) |
| Router | [React Router](https://reactrouter.com) v6 |

---

## 📂 Project Structure

```
zphase/
├── electron/           # Electron main process
│   ├── main.ts         # App entry, window management, IPC registration
│   ├── preload.ts      # Context bridge (main ↔ renderer)
│   ├── db/             # SQLite database handlers
│   └── ipc/            # IPC handlers (scanner, yt-dlp, updater)
├── src/                # React renderer process
│   ├── App.tsx         # Root app, routing
│   ├── components/     # Shared UI components
│   │   ├── AudioEngine.tsx       # Audio playback + Web Audio EQ chain
│   │   ├── Equalizer.tsx         # 10-band EQ panel component
│   │   ├── NowPlayingBar.tsx     # Bottom player bar
│   │   └── ...
│   ├── stores/         # Zustand state stores
│   ├── views/          # Page-level components
│   └── contexts/       # React contexts
├── resources/
│   └── bin/            # yt-dlp.exe, ffmpeg.exe (not committed)
└── public/             # Static assets
```

---

## 🤝 Contributing

Contributions are very welcome! Z Phase is actively developed and there are many ways to help:

### Ways to Contribute

- 🐛 **Report bugs** — [Open an issue](https://github.com/PiyushBarala/zphase/issues)
- 💡 **Request features** — [Open an issue](https://github.com/PiyushBarala/zphase/issues) with the `enhancement` label
- 🔧 **Submit pull requests** — Fork the repo, make changes, open a PR
- 🌍 **Translations** — Help localize Z Phase for other languages
- 📸 **Screenshots** — Add screenshots to the README

### Development Setup

```bash
git clone https://github.com/PiyushBarala/zphase.git
cd zphase
npm install
npm run dev
```

The app runs with hot-reload in development mode. Electron DevTools are available via `Ctrl+Shift+I`.

### Pull Request Guidelines

- Follow existing code style (TypeScript strict mode)
- Keep changes focused and atomic
- Test your changes before submitting
- Describe what and why in your PR description

---

## 📄 License

Z Phase is released under the **GNU General Public License v3.0**.
See [LICENSE](./LICENSE) for the full license text.

---

## 🙏 Acknowledgements

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — YouTube download engine
- [ffmpeg](https://ffmpeg.org) — Audio conversion
- [music-metadata](https://github.com/Borewit/music-metadata) — Audio tag parsing
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — Fast SQLite bindings
- Inspired by [Spotify](https://spotify.com) desktop design language

---

<div align="center">

Made with ❤️ for music lovers who own their audio files.

**[⭐ Star this repo](https://github.com/PiyushBarala/zphase)** if you find Z Phase useful!

</div>
