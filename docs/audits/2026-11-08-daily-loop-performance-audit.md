# Daily-loop performance audit

**Date:** 2026-11-08
**Scope:** cold start → Home → Library → thread
**Status:** Pass 1 (static) complete. Pass 2 (render-path tracing) not run.
Pass 3 (device verification) is a protocol in this document, not yet executed.
**Changes made:** none. This is an audit.

The working tree had ~20 modified files when this was written, so the line
numbers below describe the working tree, not `HEAD`.

## Question

Where would lag in Mnemo actually come from, and how much of it is real?

Not in scope: settings, onboarding, welcome, review/context browsing, wrap-up,
widget, capture pipeline, iOS, Gemini network latency. Latency is a real cost but
it is not lag; it is noted once at the end and dropped.

## Method

Three passes.

1. **Tooling and source triage** — line counts, import graph, list
   implementations, memoisation, timers, hydration path. Done.
2. **Render-path tracing** — who reads what from the store, per surface. Not done.
3. **Device verification** — a repeatable script on a release build that
   confirms or retracts every "Likely" below. Supplied at the end.

`npm run check` (tsc, eslint, vitest) did not run: the sandbox rejected every
attempt. The consequence is stated in Gaps.

## Evidence standard

Every finding carries a label:

- **Proven** — certain from source, no measurement needed.
- **Likely** — the mechanism is confirmed, the cost is not. The device protocol
  states what would settle it.
- **Ruled out** — checked and clean, with the reason.

A finding without `file:line` was not included.

---

## Findings

### P1 — One store context fans out to every screen, including the tab bar

**Proven** for the mechanism. **Likely** for felt cost.

`hooks/use-mnemo-store.tsx:696` builds one `useMemo` value containing `items`,
`entries`, `isLoaded` and every callback. Every write produces a new `items`
array, a new `entriesByThread`, and therefore a new `getEntries` identity
(`:527-530`) and a new context value. There is no selector layer.

Consumers include the persistent layout, `app/(tabs)/_layout.tsx:29`, and
`components/ui/PulseHome.tsx:241`. So a single checkbox tick on a thread
re-renders the tab layout — which renders `components/ui/ActionCluster.tsx`
(1192 lines, 37 KB) and `FloatingTabBar` — plus Home, plus Library, plus the
thread screen.

Supporting evidence: `React.memo` appears in exactly two components in the whole
app, `components/thread/EntryCard.tsx` and `components/ui/ThreadRow.tsx`. No
other component is memoised.

Impact: re-render fan-out proportional to (number of mounted screens) × (work per
render), on every data change. The multiplier is P2.

### P2 — Home recomputes its entire resume ranking on every render

**Proven.** `components/ui/PulseHome.tsx:246`:

```ts
const activeItems = resumeOrder(getActiveItems(), { focusId: focusThreadId });
```

This is in the component body, outside any `useMemo`. `getActiveItems` is a
`useCallback` keyed on `[items]` (`hooks/use-mnemo-store.tsx:660-693`), so its
identity changes after every store write, and the call re-runs regardless.

PulseHome is 596 lines with two `useMemo`s (`:290` greeting, `:297` today) — both
incidental to the main work. The per-row `nextOccurrence`, `resumeReason` and
`formatReminder` work happens in render.

Impact: each store write = full filter and sort over all active threads plus
per-row date computation. Combined with P1, Home's cost is (all threads) × (every
write), not (visible rows) × (relevant write). This is the compound most likely
to be felt.

### P3 — The whole dataset is hydrated before first paint

**Proven.**

- `lib/db.ts:405-409` — `getAllEntries()` is `SELECT * FROM entries`, mapping
  every row through `rowToEntry`, which JSON-parses `blocks`.
- `getAllItems()` follows the same shape, and `lib/db.ts:54-70` stores
  `checklistItems`, `links` and `filing` as JSON TEXT.
- `hooks/use-mnemo-store.tsx` imports `getAllItems` and `getAllEntries` —
  full-table reads are the boot path, not a lazy detail.
- `app/(tabs)/index.tsx:12-20` renders a single line, "Loading your life…",
  until `isLoaded`.

Boot is therefore a serial chain: `openDatabaseAsync` → `execAsync` (three
`CREATE TABLE`, three `CREATE INDEX`, every launch) → `runMigrations` →
`getAllItems` → `getAllEntries` → `deriveThreadCache` → first paint, with no
incremental render to hide behind.

Impact: startup cost is linear in how much the person has written. A fresh
install is fast; the same code becomes slow. This is the only finding on this
list whose cost is guaranteed to grow with use, and it is invisible in code
review and in the test suite.

### P4 — The thread view is not virtualised, while Library is

**Proven** for structure. **Likely** for cost on typical threads.

`app/(tabs)/context.tsx` renders one `ScrollView` (`:410` → `:868`) containing
`shownEntries.map(...)` (`:816`) that renders `EntryCard` (`:818`). Every entry
in a thread mounts at once, including photos, measures, checklists and link
previews. `EntryCard` being `React.memo`'d limits re-renders but not mount or
memory cost.

`app/(tabs)/library.tsx:282-292` does the opposite and does it well: a `FlatList`
with stable `keyExtractor`, `initialNumToRender={14}`, `windowSize={7}` and
`removeClippedSubviews`. The inconsistency is the finding, not the thread view in
isolation — one of the two screens was tuned and the other was not.

Impact: longest threads are exactly the ones a person returns to, which is the
product's core promise.

### P5 — The recording meter re-renders React about 11 times a second

**Proven.** `components/ui/ActionCluster.tsx:851-861`:

```ts
setInterval(() => {
  const sample = levelNow.current;
  setLevels((prev) => [...prev.slice(1), sample]);
  level.value = withTiming(sample, { duration: 90 });
  setElapsed(Date.now() - startedAt);
}, WAVE_SAMPLE_MS);
```

Two React state writes per tick, at `WAVE_SAMPLE_MS` (~90 ms), inside the
persistent tab-layout subtree. The bar heights are already driven by the
Reanimated shared value on the next line, so `setLevels` exists to re-render the
component — roughly 11 renders/second of a 1192-line subtree while recording.
`setElapsed` is the same. The interval is correctly cleaned up and only runs
while `isLive`.

Impact: confined to recording, but that is the moment when a dropped frame is
most noticeable, and it runs on the screen whose whole job is to feel immediate.

### P6 — The Google SDK is eagerly bundled

**Proven**, and narrower than first suspected.

`lib/gemini.ts:1` statically imports `@google/genai`. The only dynamic import in
the entire app is `app/wrapup.tsx:67` (`react-native-view-shot`). Confirmed
importers of `gemini.ts`: `app/(tabs)/context.tsx:42` and
`components/AskCard.tsx:10`.

Correction to an earlier assumption in this audit: `PulseHome` does **not** pull
the SDK in. Its imports are `when`, `away`, `card-flight`, `preferences`,
`routes`, `ai-mode` and UI modules. So the SDK is resident once the Context tab
mounts, not at cold start.

Impact: bundle and memory weight, not lag. Ranked last for that reason.

### P7 — No component or screen is covered by a test

**Proven.** 28 test files in `tests/`, every one at `lib/` level. Nothing would
catch a regression in P1-P5. This is why Pass 3 matters: for UI work in this
repo, the device is the only safety net.

---

## Ruled out

| Checked | Verdict | Evidence |
| --- | --- | --- |
| Library list performance | Clean | `library.tsx:282-292` — virtualised and tuned |
| Search recomputing per keystroke | Clean | `library.tsx:80` — `useDeferredValue` |
| Context value not memoised | Clean | `use-mnemo-store.tsx:696` — is memoised |
| Thread derived data recomputed per render | Clean | `context.tsx:96-108` — entries, steps, measures, quiet days all memoised |
| Ranked row identity in Library | Clean | `useCallback` at `library.tsx:147` |
| File size as a cause of lag | Not a cause | Hermes precompiles the bundle; module size is a readability cost |

## Gaps

1. **`npm run check` did not run.** The most valuable remaining static check is
   an `eslint-plugin-react-hooks` `exhaustive-deps` sweep over `useEffect`s,
   where duplicated or missing work of the P1/P2 kind usually hides. Run
   `npm run lint` before treating this audit as complete.
2. **Pass 2 not run.** P1 and P2 are proven in isolation but their combination
   is inferred. Tracing each surface's store reads would let the fan-out be
   counted rather than argued.
3. **No dataset sizes.** Nothing here says how many threads, entries or photos a
   real user has. P3 and P4 are linear in that number and their severity depends
   entirely on it.

## Pass 3 — device verification protocol

Run on a **release** build. Debug builds are 2-5× slower and produce misleading
numbers.

```bash
npx expo run:android --variant release
```

Then, with the device attached and React DevTools open:

1. **Cold start (P3).** Force-stop the app. Start it with
   `adb shell am start -W` and record `TotalTime`. Repeat three times, take the
   median. Note item and entry counts if the app exposes them.
2. **Render fan-out (P1/P2).** In DevTools, enable "Highlight updates". Open Home,
   then tick one checklist item on a thread with ≥10 open steps. Every component
   that flashes is a P1 confirmation. Paste the component names.
3. **Home ranking (P2).** React Profiler → record → navigate Home → tick one
   checkbox on another thread → stop. Report: number of commits, and
   `PulseHome`'s render duration in the commit caused by the tick.
4. **Thread mount (P4).** Open the longest thread available. Report the commit
   duration, and whether scrolling drops frames in a 60 fps screen recording.
5. **Recording (P5).** Start a voice capture, hold 10 seconds. Record with
   `adb shell dumpsys gfxinfo <package> framestats`.
6. **Bundle (P6).** `npx expo export --platform android` and record the Hermes
   bundle size as a baseline.

For each finding the outcome is one of: **confirmed** (with the number),
**smaller than expected** (with the number), or **retracted**.

## Not in scope, noted once

Gemini round-trips dominate perceived capture latency and have nothing to do with
frames: `processVoiceDump`, transcription and embedding generation are network
bound. If capture *feels* slow, this audit does not explain it and should not be
used to justify work on it.

## If work is later authorised

Ordering by severity × confidence, cheapest-first within each band:

1. P3 — incremental hydration, or render the recent N threads and finish loading
   in the background. Largest guaranteed win, and the only finding that gets
   worse over time.
2. P2 — memoise the resume ranking in `PulseHome`. One-line change, removes the
   worst per-write cost.
3. P1 — split the store into `items` / `entries` / actions contexts, or add a
   selector hook. Touches every consumer; do it after P2 proves the shape.
4. P4 — move the thread view to a `FlatList` matching `library.tsx`.
5. P5 — drop the redundant React state in the level meter; drive it from the
   existing shared value.
6. P6 — lazy-import `gemini.ts` from the Context tab and `AskCard`.
