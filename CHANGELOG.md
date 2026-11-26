# Changelog

All notable changes to Mnemo, newest first. Versions match `app.json`. Everything before 1.0.0 is summarised by phase.

## [Unreleased]

## [2.0.5] - 2026-11-26

### Added
- **Notes named on the phone (optional).** Settings → How Mnemo thinks → Name notes on the phone downloads a small on-device model: Qwen3.5-0.8B (533 MB, faster) or Qwen3.5-2B (1.3 GB, better names, categories and Bangla titles). Offline, it gives a note's thread a short title and tags a few seconds after it's saved. With Gemini on, it stands in when Gemini can't answer (no connection, daily limit, busy), and Gemini rewrites the note once it can. It never rewrites the note itself. Only one model is kept on the phone.
- **Live debug (hidden).** Tap the version in Settings → About seven times. It shows notes waiting for Gemini (with why, and Send all now), Android's answer about places, where the phone is against each watched place ("would ring now"), and the place, voice and error logs as they're written, newest first. Hide it again from the screen itself.
- **Live debug shows what's happening behind the scenes, as it happens.** Each note's steps: saved, queued, which Gemini model was asked and how long it took (tokens in and out), what came back (title, what it heard, kind, next step, the thread match), where it was filed, a reminder set; failures with the next try's time. The mic and the phone's recognizer too: on, each phrase heard, pauses, errors, language switches. A **floating overlay** puts the current step, with a running clock, over every screen; tap it for the last few. Kept in memory only, never in the problem report.
- **Routines on Home.** A repeating place reminder ("every weekday when I get to the office") is listed under **At places** with where and when it next rings, instead of as a thread going cold. Once it rings it stays there, quietly, with when it went off; it rings once a day either way.
- **The problem report explains a missed place reminder.** It lists each place reminder as Mnemo sees it (inside or outside, since when, last rang) and the last 30 place events: what Android sent, when the places were set, what opening the app caught, and why a crossing didn't ring (already counted inside, back within the hour, not one of its days, done today). Short ids only, no titles or coordinates. Times are local. It also lists what Android's side heard and did, even when Mnemo never woke up, which tells "Android never said" apart from "Mnemo heard it and didn't ring".
- **The problem report explains voice notes too:** how notes are taken (recorded for Gemini, or heard by the phone), and for the last 30: how long, how many words, the recognizer's own errors, a recording the phone cut short, and how each was written out. Counts and codes only, never the words.

### Changed
- **Settings, reorganised.** How Mnemo thinks comes first; nudges, appointments, place reminders and the reminder check sit together under Reminders; then Backup, Appearance, Help and feedback, About. Suggest a feature, Clear log, Source code and Go through setup again are gone.
- **Search by meaning is off.** It sent every note to Google a second time. It may come back, made on the phone, if that costs no noticeable speed or battery.
- **A reminder reads as a reminder.** A thread with a time or place reminder and one thing to do drops Where you left off, Listen back and the quiet-days prompt, and its step shows as Remember to.
- **A quieter Home.** At most one notice sits above the Resume card at a time: a Gemini problem first, then checking reminders, a place reminder at risk, then backups. The "notes written by Flash-Lite" notice and the Browse chips are gone; the Library tab already browses by kind.

### Fixed
- **Voice notes are no longer written out in the wrong language when Gemini is busy.** A busy Gemini now keeps the recording and tries again; Whisper steps in only after about a minute and a half, or when Gemini can't do it at all, and is told the language up front, so Bangla isn't guessed as English or Hindi.
- **Bangla heard in Hindi script no longer switches listening to English.**
- **The app no longer lags while a downloaded model is checked:** the check runs in native code, in the background.
- **Voice notes heard by the phone no longer stop listening during pauses.** Every few seconds of silence ended a session, and four in a row stopped listening for good while the screen still said "Listening…". Pauses now just restart; only real errors count, and if listening does stop, the screen says so.
- **A voice note whose recording couldn't be read** no longer ends up as a blank note: it says so, and it's in the problem report.
- **A thread stuck on "Being read…".** A note finished without being written out (its recording unreadable) left its thread saying "Being read…" for good. Such threads are now released, and any already stuck are cleared on the next open.
- **A note that keeps failing to be written out says why.** After two failed tries, its chip says "Not yet: Gemini is busy" (or no connection, daily limit, …) instead of "Processing", and the voice log records the reason once.
- "Couldn't start recording" with Gemini on now says the mic may be in use, not that speech recognition is missing.
- Place reminders still set are no longer nudged as "untouched for N days", and don't show as "gone quiet" or as open steps in the weekly review: they're waiting for the place, like a reminder set for a later time.

## [2.0.4] - 2026-11-17

### Added
- **An animated intro:** the logo is drawn in code, then the name and tagline, over a plain launch screen.
- **Settings: a back button** beside the title, an About section with a link to the source code, and "Report a bug" and "Suggest a feature" rows that open a prefilled GitHub issue.

### Changed
- The pin-drop map opens one zoom closer.
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
