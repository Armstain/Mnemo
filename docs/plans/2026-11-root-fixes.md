# Plan: know whether geofences are set, and store what notes mean

Follows `docs/audits/tasks-and-reminders-2026-11.md`. Two root causes behind most
of the last two weeks' fixes:

* **A.** Mnemo can't tell whether Android actually registered its geofences, so
  each fix guessed one more moment to reset them.
* **B.** Mnemo works out what a note means (a single task or a project; money
  spent or owed; whether a number is worth showing) but keeps none of it, so
  each screen guesses again or doesn't check.

No code changes yet. Decisions needed from you are marked **Decision**.

---

## A. Geofence registration with a known result

### What is wrong today (checked in the installed sources)

`expo-location`'s Android `GeofencingTaskConsumer.startGeofencing()`:

1. calls `GeofencingClient.addGeofences(...)` and **never attaches a success or
   failure listener**, so `startGeofencingAsync` resolves whatever Android says;
2. **returns silently** when no location provider is available;
3. is also what runs **after a reboot** (expo-task-manager's `BOOT_COMPLETED`
   receiver → `TaskService.restoreTasks()` → the consumer again), so a refusal
   after a restart is invisible too.

Each of `633cfba`, `a3471b9`, `97390b2` and the network check in `1e9d967` works
around this from JavaScript.

### Options

| | What | For | Against |
|---|---|---|---|
| 1 | **Own task consumer** in `modules/mnemo-reliability`, registered through expo-task-manager like expo-location registers its own | Same event delivery and boot restore that already work (headless JS, the existing `mnemo-geofence` task); we add only the part that's missing | Uses expo's "legacy" `TaskManagerInterface` (still what expo-location itself uses in SDK 57) |
| 2 | Patch expo-location to add the listeners | Smallest diff | Needs `patch-package` (new dependency); breaks silently on every Expo upgrade |
| 3 | Own geofencing end to end, with React Native's `HeadlessJsTaskService` | Full control | New background JS path on the New Architecture (bridgeless), and boot restore to rebuild; the riskiest part is the part that works today |

**Recommendation: option 1.** I had said "register geofences in our own module";
having read expo-task-manager, the right cut is narrower: keep expo's delivery,
replace only registration.

### Design

**Native (Kotlin, `modules/mnemo-reliability`)**

* `MnemoGeofencingConsumer : TaskConsumer` (≈150 lines), same shape as
  expo-location's, plus:
  * `addGeofences(...).addOnSuccessListener / addOnFailureListener`;
  * the "no provider" and missing-permission cases reported, not skipped;
  * every outcome written to SharedPreferences `mnemo.geofence`:
    `{ state: 'ok' | 'refused' | 'no-provider' | 'no-permission', code?, count, at, afterBoot }`;
  * a refusal also delivered to the JS task as an error, so the existing
    handler in `lib/geofence-task.ts` sees it even with the app closed.
  * Events delivered to JS in exactly today's shape (`{ eventType, region }`),
    so `handleGeofenceEvent` doesn't change.
* Module functions: `startGeofencing(task, regions): Promise<Outcome>` (waits for
  Android's answer, 10 s limit → `'unknown'`), `stopGeofencing(task)`,
  `geofenceOutcome(): Outcome | null` (last stored, including after a reboot).
* Gradle: `play-services-location` (already in the app through expo-location;
  same version) and expo-modules-core's task interfaces.
* **Release builds shrink code**: expo-task-manager finds the consumer by class
  name after a reboot (`Class.forName`), so it needs a keep rule in
  `app.json` next to the existing `RNHeadlessAppLoader` one. Without it, restore
  after a reboot fails only in release builds.
* Class name and its version constant stay fixed from then on: they are stored
  by expo-task-manager and read back on boot.

**JavaScript (`lib/geofence.ts`)**

* `syncGeofences` registers through the module on Android (expo-location stays
  for iOS and as the fallback if the module is missing). The watch list is
  recorded only when the outcome is `ok`; anything else is retried at the next
  sync and shown.
* Removed, because the outcome replaces the guess: the network-location
  pre-check, `forgetWatch` on error-message matching, the "set once per launch"
  flag (re-setting at launch stays, but only because Android may have dropped
  them, and the result now says whether it worked).
* Settings → Location and the problem report show the real state: "Watching
  2 places since 9:02", or "Android refused after the last restart: location
  accuracy is off. Turn on".

**Migration of existing installs**

Installed phones have `mnemo-geofence` persisted with expo-location's consumer.
On the first sync after the update: if that consumer holds the task, stop it,
then register ours under the same task name. The JS task definition is unchanged.
Tested by installing the new build over the current one.

### Tests

* JS: `tests/geofence-pipeline.test.ts` gets a mocked module: `ok` records the
  list; `refused`/`no-provider` don't and say why; a stored after-boot refusal
  shows on opening; the module missing falls back to expo-location.
* Native: the repo has no Android test setup; adding one for ~150 lines isn't
  worth it. Verified on devices instead, in a release build: a Pixel or Samsung
  and, ideally, a Xiaomi/Oppo/Transsion. Cases: register; location accuracy
  off then on; reboot without opening Mnemo; update over the old version.

### Size and risk

About 250 lines of Kotlin, 100 of TypeScript, a day or two plus device testing.
Risks: expo changing `TaskManagerInterface` in a later SDK (it would break at
build time, not silently); OEMs that block the boot receiver (unchanged from
today, but now visible).

---

## B. Store what notes mean

Three independent pieces, smallest data change first.

### B1. Money gets a direction (data; do first) — done

Decided: money counts when it's paid. Implemented in `lib/understand.ts`
(`moneyWay`), `lib/measures.ts` (`countsAsHappened`, `numbersToShow`, Gemini
synonyms), `lib/review.ts`, `lib/wrapup.ts`, the thread screen and
`MEASURE_RULES`; tests in `tests/money-direction.test.ts`.

Today every money amount that isn't income or a price becomes `spent`
(`metricFor` in `lib/understand.ts`; Gemini's `MEASURE_RULES` only ever
mention "spent"). "দোকানের ২০ টাকা বাকি" is counted as spending, and will be
counted again when it's paid.

**Change.** `Measure.metric` is free text and already carries the meaning
(totals group by it), so no new field is needed. Money gets a fixed set of
metrics:

| Metric | Means | Counted in "spent"? |
|---|---|---|
| `spent` | money left your hand | yes |
| `received` | money came in | (its own total) |
| `owe` | you owe someone (বাকি, ধার নিলাম, owe) | no |
| `lent` | someone owes you (ধার দিলাম, পাওনা, lent) | no |
| `planned` | you will pay or buy (দিতে হবে, need to pay, budget) | no |
| `price` | a price you're comparing (unchanged) | no |

* **Decision (B1-a):** count money **when it's paid** (cash view). The বাকি
  note is `owe 20`; "paid the shop 20" later is `spent 20`. The alternative
  (count the debt as spending when made, and the payment as nothing) needs
  linking a payment to its debt, which the phone can't do reliably from words.
* Phone reading: owe / lent / planned words in English, Banglish and Bangla
  (one table in `lib/understand.ts`); owe beats planned ("বাকি … দিতে হবে" is a
  debt).
* Gemini: `MEASURE_RULES` lists the money metrics and says "spent only for
  money already paid"; `verifyMeasures` keeps an unknown money metric as given
  (no silent re-labelling).
* Totals: the weekly review's "Added up" and the thread's Numbers count `spent`
  as spending; `owe` and `lent` show as what's still open ("You owe BDT 20"),
  and an open thread's `owe` stops showing when the thread is done.
* Existing notes: unchanged, no migration. A wrong old "spent" is fixed with the
  pencil on the card (renaming a metric already exists).
* Tests: `tests/understand.test.ts` (the বাকি note, "ধার দিলাম ৫০০", "need to
  pay rent 8000 on the 5th", "spent 300 on lunch" still spent), verifyMeasures,
  review totals.

### B2. What finishes a thread (behaviour; needs decisions)

Today a step being ticked and a thread being done are two states with no rule
between them, so a one-step task shows two Done controls and each does half.

**Change.** One pure function, `finishModel(thread, entries)` in `lib/done.ts`,
computed every time (nothing new stored), from data that already exists
(`kindOf`, open steps, queued steps, repeat):

| Model | When | Thread screen | Notification "Done" |
|---|---|---|---|
| `occurrence` | a repeating reminder (today's rule from `1e9d967`) | "Done for today" | today's occurrence |
| `single` | a task with at most one open step and nothing queued | **one** Done: ticks the step, clears the reminder, finishes the thread, one Undo | finish the thread too (decided) |
| `steps` | a project, or a task that has gained steps | ✓ ticks steps; Done finishes (Wrap-up when there's history) | ticks the step (as today) |
| `note` | no kind, no step, no reminder | Done finishes | n/a |

* The thread screen, Welcome, the weekly review and notification buttons all
  ask `finishModel`; the "Done for today" branch moves out of the screen into it.
* A wrong guess corrects itself: a "task" that gets a second step or a queued
  step becomes `steps` on the next render.
* Decided (B2-b): no hand-set model for now; see whether the automatic rule is
  wrong in practice first.
* Store: one transition, `finishTask(id)`, doing step done + reminder cleared +
  thread finished as one change with one undo (today they are three).
* Tests: `finishModel` table tests; the store transition; ReminderActions per
  model.

### B3. Numbers worth showing (presentation)

One rule in `lib/measures.ts`, `worthShowing(summary)`, used by the thread's
Numbers section and the weekly review:

* a total shows only with 2 or more values (one value is already in the note);
* the bar and group rows only with 2 or more groups;
* "1 item" never shows.

Tests: the rule itself, with today's single-value case.

---

## Order

1. **B1** (data is wrong today, in every weekly total). Small, no decisions
   beyond B1-a.
2. **B3** (half a day; independent).
3. **B2** after decisions B2-a and B2-b.
4. **A** in parallel, but it needs a dev or release build on a phone to finish;
   it can be written and unit-tested here.

Each is its own commit with its own tests; `npm run check` green at each step.

## Out of scope

iOS geofencing (stays on expo-location); a kind picker; linking debts to their
payments; anything not listed above.
