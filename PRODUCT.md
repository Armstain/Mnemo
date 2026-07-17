# Product

## Register

product

## Users

People with busy, interrupted lives who context-switch constantly — knowledge workers, students, parents. They open Mnemo in stolen moments (walking between meetings, winding down at night, standing in a store) to dump a thought before it evaporates, and later to pick a paused thread back up. Sessions are short and often one-handed; the primary capture mode is voice.

## Product Purpose

Mnemo is a "resume your life" memory app. It captures thoughts (voice, notes, checklists), structures them with AI (title, summary, where-you-left-off, next step), and makes re-entry instant: open the app, see the thread you dropped, resume it. Success = the time between "I had a thought" and "it's safely captured" approaching zero, and zero restart friction when returning.

## Brand Personality

Calm, nocturnal, luminous. The app is a quiet dark room where your thoughts glow softly — not a productivity dashboard shouting metrics. Three words: **ambient, focused, weightless**. The signature visual language is **liquid glass**: translucent surfaces floating over a deep, softly-lit color field.

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

## Accessibility & Inclusion

- Text on glass must meet WCAG AA: ≥4.5:1 for body/secondary text against the darkest point of the ambient field (in practice: white at ≥60% opacity for body, ≥45% only for large/decorative labels).
- All interactive targets ≥44pt; icon-only buttons carry `accessibilityLabel`s.
- Ambient background drift must respect reduced-motion (static field when enabled).
- Voice capture is a first-class alternative to typing, and typing is always available as a fallback to voice.
