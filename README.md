# Mnemo

**Resume your life.**

Mnemo is a memory app for busy, interrupted people. It captures your thoughts the
second they appear — usually by voice, one-handed — organises them into meaningful
threads, and helps you pick up right where you left off. No staring at a blank note
wondering what you meant. No lost threads.

## The idea

Sessions are short and stolen: walking between meetings, winding down at night,
standing in a shop. Mnemo optimises for two moments:

1. **Capture** — the time between "I had a thought" and "it's safely captured"
   should approach zero.
2. **Re-entry** — opening the app should answer "what was I doing?" instantly,
   not show you an archive to browse.

## Features

- 🎙️ **Voice-first capture** — hold, speak, done. Online, Gemini transcribes
  (Bangla, English, or both mixed in one sentence); if Gemini can't, Groq's Whisper
  steps in as backup. Offline, your phone's own speech recognition takes over and
  nothing is recorded.
- 🧵 **Threads, not notes** — captures are organised into threads with an AI-written
  title, summary, *where you left off*, and *next step*. Auto-filing suggests where
  things belong; you stay in control.
- ⏰ **Reminders that actually fire** — natural language ("remind me in 20 mins"),
  repeats, and serious reliability engineering for Android's battery-saving habits.
- 🔍 **Search that finds things** — hybrid keyword + semantic search.
  No connection? Keyword search still works.
- 📓 **Reviews & digests** — wrap-ups and nudges resurface what matters before it
  goes cold.
- 📸 **More than text** — checklists, photos, links with previews, measures and
  rollups.
- ⚡ **Capture from anywhere** — home-screen widget, quick actions, share intents
  from other apps.
- 🔒 **Encrypted backups** — passphrase-protected, photos included, nothing uploaded
  anywhere.

## Privacy

Mnemo is local-first. There is no account, no server, no analytics, no ads.

- **Your data lives on your phone.** Notes, threads, photos, voice recordings.
- **Bring your own key.** AI features use *your* Gemini API key (a Groq key is
  optional, as transcription backup). Keys are stored in your phone's secure
  storage. No key is ever bundled with the app.
- **What leaves your phone, and only with your key:** note text, voice recordings
  and photos sent to Google for transcription and structuring; thread titles for
  filing; link previews fetched by your phone. Voice recordings are deleted once
  transcribed.
- **What never leaves:** everything else. There is no telemetry — nothing to opt
  out of, because nothing is collected.

Read the full privacy notes in the app (Settings → Privacy) and in
[PRODUCT.md](PRODUCT.md).

## Tech

Built with Expo (SDK 57) and React Native, in strict TypeScript:

- **Navigation:** expo-router (typed routes)
- **Storage:** SQLite (`expo-sqlite`) with versioned migrations; preferences in
  AsyncStorage; secrets in `expo-secure-store`
- **Search:** BM25 keyword index + Gemini embeddings (768-dim, stored locally)
- **Voice:** `expo-audio` recording; Gemini / Groq Whisper / on-device recognition
- **Native:** Android widget, quick actions, share intents, reliability helpers

## Project structure

```
app/            # Screens (expo-router): tabs (Home, Library, Context), capture, review, wrap-up…
components/     # UI components
lib/            # Core: db, AI clients, voice, search, backup, reminders
hooks/          # State (mnemo store), capture, accessibility
modules/        # Native modules (Android reliability)
widgets/        # Android widget
plugins/        # Expo config plugins
docs/           # Specs & platform notes
tests/          # Unit tests (vitest)
```

Key docs: [PRODUCT.md](PRODUCT.md) (vision, design principles, privacy),
[docs/specs/threads.md](docs/specs/threads.md) (threads data model),
[docs/reminders-on-android.md](docs/reminders-on-android.md) (reminder reliability).

## Development

Prerequisites: Node LTS.

```bash
npm ci            # install dependencies
npm run check     # typecheck + lint + tests (CI runs this on every push)
npm start         # start the Expo dev server
npm run android   # run on Android
npm run ios       # run on iOS
npm test          # unit tests (vitest)
```

On first launch the app asks for your Gemini API key —
[get one free from Google AI Studio](https://aistudio.google.com/apikey).
It's stored only in your device's secure storage.

## Status

Mnemo is **Android-first and ready for dogfooding**. iOS support (widget, share
intents, production builds) is in progress. If you're evaluating the code, start
with [PRODUCT.md](PRODUCT.md).
