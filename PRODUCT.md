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

Calm, nocturnal, luminous. The app is a quiet dark room where your thoughts glow softly — not a productivity dashboard shouting metrics. It follows the system theme: the light theme keeps the same softly-lit glass, never a flat white page. Three words: **ambient, focused, weightless**. The signature visual language is **liquid glass**: translucent surfaces floating over a deep, softly-lit color field.

## Anti-references

- SaaS dashboard aesthetics: stat tiles, KPI rows, dense chrome.
- Sterile flat-gray dark modes (pure #111 cards on #000, no light in the scene).
- Skeuomorphic "notebook" apps with paper textures and serif body copy.
- Glassmorphism-as-decoration: blur slapped on opaque backgrounds where nothing shows through. Glass here is the committed material system, and every glass surface must have visible color behind it to refract.

## Design Principles

1. **Glass is a material, not a filter.** Every translucent surface sits over the ambient color field; if nothing shows through it, it isn't glass.
2. **One capture gesture from anywhere.** The mic is the hero of the home screen; nothing competes with it.
3. **Re-entry over browsing.** Surfaces optimize for "what was I doing?" — the resume card, next steps, and where-you-left-off always outrank archives.
4. **Motion conveys state.** Pulses mean "listening", drifts mean "ambient"; nothing animates for decoration on task surfaces.
5. **Native where it counts.** Real iOS 26 Liquid Glass when available; the fallback must be indistinguishable in spirit on Android/web.
6. **Local first, AI optional.** Capture never waits on a network or a key; AI makes a capture better afterwards, and the phone's own reading is always the floor.

## Accessibility & Inclusion

- Text on glass must meet WCAG AA: ≥4.5:1 for body/secondary text against the darkest point of the ambient field (in practice: white at ≥60% opacity for body, ≥45% only for large/decorative labels).
- All interactive targets ≥44pt; icon-only buttons carry `accessibilityLabel`s.
- Ambient background drift must respect reduced-motion (static field when enabled).
- Voice capture is a first-class alternative to typing, and typing is always available as a fallback to voice.
