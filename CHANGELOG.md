# Changelog

All notable changes to Mnemo, newest first. Versions match `app.json`. Everything before 1.0.0 is summarised by phase.

## [2.1.0] - 2026-11-17

### Added
- **An animated intro** with the name and tagline, shown after the launch screen.
- **Settings: a back button,** an About section with a link to the source code, and "Report a bug" and "Suggest a feature" rows that open a prefilled GitHub issue.

### Changed
- The pin-drop map uses CARTO Voyager tiles, so place names are sharper and there are more of them. The privacy text now says the tiles come from CARTO, built on OpenStreetMap data.
- Settings rows are tighter, and "Help" and "Something not working?" are grouped as "Help and feedback".

## [2.0.3] - 2026-11-16

### Added
- **Place reminders.** "When I get to" or "when I leave" a place. Optional, in their own Settings section; drop a pin to add a place; say it by voice. Repeat every time, on weekdays, at weekends, or on days you pick, and ring again after an hour away.
- **Reminders that ring with Mnemo closed.** Geofences are registered natively and Android's answer is recorded, with a real ringtone that survives release builds and its own buzz.
- **Warnings instead of silence.** Mnemo says when Google Location Accuracy is off, when a reminder waits for the next crossing, and when a dropped geofence was re-added.
- **Richer reminders.** More repeats, appointment heads-ups with a calendar, and a "Reminder set" notice. The heads-up's OK opens the app.
- **Welcome back.** A full welcome-back page and a short digest on Home, with short due times.
- **Search in any script.** Words are found in any language, with each language's rules as a pack, and hidden search terms are written when a note is filed.
- **Ask your notes, on the phone first.** "What did I say about X" shows your own passages from the phone; Gemini answers only if asked. Related threads are worked out on the phone from many signs.
- **Search by meaning is a setting,** off by default, because it sent every note to Google a second time.
- **Numbers read the way people write them.** Money has a direction and counts as spent only when the note says it was paid; a summary shows only when it says something new.
- **Haptics.** One gated module with Android native effects, a vibration switch in Settings, and problem-report rows.
- **GitHub Actions** builds the arm64 APK and attaches it to a release on a version tag.

### Changed
- The AI is called "Smart mode" in the app, not by the model's name.
- Settings holds controls only; explanations live on a "How Mnemo works" page.
- Library filters are status and category.
- Done follows one rule from what the thread is. On a repeating reminder it completes only that occurrence, and says "Done" once the reminder has rung.
- A routine no longer takes Home's main card just for being due again.

### Fixed
- AI: one Flash and one Flash-Lite per note with no second pass; a note Gemini declines finishes on the phone instead of sticking, and Retry on it ends without an error; the safety category is named and only HIGH blocks; unreadable or empty answers fall through to the next model; waiting notes go two at a time.
- Places: removed places no longer come back; arrivals are caught while Mnemo is open and just after geofences are set; geofences are set once "all the time" is granted.
- Connected notes never merge reminders.
- Library: no entrance replay on filter taps, and steadier search.
- Embedding in batches now stores one vector per note.

## [2.0.2] - 2026-10-29

### Fixed
- Flash-Lite fallback; a 504 counts as busy; daily and per-minute quota are worded differently.
- The daily quota reset is shown in the phone's own time, not Dhaka's.
- Groq is re-asked as Bangla only for a Bangla speaker.

## [2.0.1] - 2026-10-29

### Changed
- Android builds are arm64 only, with code and resource shrinking.

### Fixed
- Groq never received a recording.
- One model out of quota no longer stops every note.
- Gemini and Groq requests have time limits, and Mnemo says why Groq didn't write a recording out.

## [2.0.0] - 2026-10-28

### Added
- **Automatic backup** once a day into a folder you choose (Android), sealed with a passphrase kept in secure storage. Home warns when notes are at risk.
- Share a link into Mnemo and have it categorised without writing a note.
- Several timed steps in one note, and no overdue on finished threads.
- Closing-ring moment and haptics when a real task is finished.
- Loose notes are organised by theme instead of a forced digest.
- The AI sees what a saved link's page says about itself.
- Onboarding spots a Gemini key you copied from AI Studio and returns to a privacy-first key step.
- Privacy has its own screen; a README with a product overview and dev setup.

### Changed
- The thread comes first and occasional actions sit in a ⋯ menu.
- Home's Resume card is compact, says why it is first, opens into its thread, and is followed by "Up next".
- Navigation: a notched tab bar that cradles the capture button, named tabs, and a Library icon that says "your notes".
- Gemini models are chosen from what the key can use, preferring the newest Flash even as a preview.
- Offline speech is read one clause at a time, and Bangla word matching is fixed.

### Fixed
- Gemini "high demand" errors are ridden out, and finished threads get no Resume briefing.
- The Home tab works from inside a thread; Home no longer says the title twice.
- A log of past days is no longer read as a list of plans.

## [1.0.0] - 2026-10-17

Everything up to the first release.

- **April 2026, prototype.** Expo app with capture, an archive, a context view and Gemini summaries; a calm redesign; voice recording that Gemini transcribes and answers in the speaker's language; API key security, onboarding, edit mode, BM25 search, export and settings.
- **July to August 2026, recorder.** A single capture button: hold to record in place, slide up to cancel, tap for the menu; an SQLite store, search indexing and embeddings; undo for deletes; a manual light and dark override. A liquid-glass look was tried and removed.
- **October 2026, rebuild.** A signature "Paper and Ink" look and one design system; notes became threads with a timeline of entries, auto-filing, a focus thread and tracked numbers; due-date reminders, gentle nudges and quick actions; Expo SDK 57; encrypted export and import; speech-to-text on the phone with no audio kept; smart offline note-taking; proper Bangla support; share into Mnemo with photos and link previews; an Android home-screen widget; a weekly review, reply from reminders and wrapping up a thread; reminders that work on Xiaomi and other strict phones; tests, lint, CI and a crash screen.
