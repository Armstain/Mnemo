# Product

## Register

product

## Users

People with busy, interrupted lives who context-switch constantly — knowledge workers, students, parents. They open Mnemo in stolen moments (walking between meetings, winding down at night, standing in a store) to dump a thought before it evaporates, and later to pick a paused thread back up. Sessions are short and often one-handed; the primary capture mode is voice.

## Product Purpose

Mnemo is a "resume your life" memory app. It captures thoughts (voice, notes, checklists, photos, links), structures them with AI (title, category, summary, where-you-left-off, next step), files them into threads, and makes re-entry instant: open the app, see the thread you dropped, resume it. Success = the time between "I had a thought" and "it's safely captured" approaching zero, and zero restart friction when returning.

## Scope

In: everything under [Features](README.md#features). Out, for now:

- File attachments (PDF, Word, other documents). Shared files other than photos are not saved.
- Accounts, sync, a server, collaboration.
- iOS parity: Android-first, iOS widget, share intents and production builds are in progress.

## Privacy

Local-first: no account, server, analytics or telemetry. What leaves the phone, and only with the person's own key, is listed in [README Privacy](README.md#privacy).

## Brand Personality

Calm, warm, unhurried. The app is a quiet notebook that remembers for you, not a productivity dashboard shouting metrics. Three words: **warm, focused, weightless**. The visual language is **Paper / Ink**: ivory paper and deep emerald in light, warm black ink and a raised emerald in dark. Surfaces are solid tones, not translucency, so text contrast is the same wherever a card lands. A serif (Literata) carries titles and what you said; a sans (Instrument Sans) carries everything else. The signature mark is the **open ring**: the logo, and on every thread a ring whose length shows how warm it still is.

## Anti-references

- SaaS dashboard aesthetics: stat tiles, KPI rows, dense chrome.
- Sterile flat-gray dark modes (pure #111 cards on #000). Dark mode is warm ink, not gray.
- Skeuomorphic "notebook" apps with paper textures. Paper here is a colour, never a texture.
- Glass, blur and glow as decoration. Depth is kept for the one thing that matters most on a screen.

## Design Principles

1. **One lit surface per screen.** The Resume card is the only inverted, lit surface on Home; everything else stays quiet so it reads first.
2. **One capture gesture from anywhere.** The capture button is the hero; nothing competes with it.
3. **Re-entry over browsing.** Surfaces optimize for "what was I doing?": the resume card, next steps and where-you-left-off always outrank archives. On a thread, the thread comes first and occasional actions live in its ⋯ menu.
4. **Motion conveys state.** Rings fill as threads warm up, rows slide when a list changes, pulses mean "listening". Nothing animates for decoration, and Reduce Motion turns travel into a short fade.
5. **Never say the same thing twice.** A preview, next step or label that repeats the title is left out.

## Accessibility & Inclusion

- Text must meet WCAG AA: ≥4.5:1 for body and secondary text on every surface it sits on, in both themes.
- All interactive targets ≥44pt; icon-only buttons carry `accessibilityLabel`s.
- All motion respects Reduce Motion: no travel, just a short fade.
- Voice capture is a first-class alternative to typing, and typing is always available as a fallback to voice.
