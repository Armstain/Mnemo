# Audit: task completion, place reminders, repeating reminders (Nov 2026)

Scope: why "Done" behaves differently in different places, why place reminders
sometimes never ring after notes get connected, and why a weekday place
reminder can vanish after "Done". Written before any code was changed; the
"What changed" section at the end records what was done about each finding.

## 1. Architecture map

There is no separate reminder or task table. **A thread (`MnemoItem`) owns
everything about itself**, including its reminders:

| Concept | Where it lives | Lifecycle owner |
|---|---|---|
| Note / thread | `items` row (`MnemoItem`), history in `entries` rows | `hooks/use-mnemo-store.tsx` |
| Task completion | `MnemoItem.status = 'completed'` + `completedAt` | store `completeItem` |
| Step completion | `Entry.stepDone`, derived `MnemoItem.nextStep` | store `completeNextStep` |
| Time reminder | `dueDate`, `repeat` (daily/weekly/monthly), `laterSteps` | `lib/reminders.ts` (expo-notifications; id = thread id) |
| Place reminder (one per thread) | `MnemoItem.place: PlaceReminder` (JSON column) | rules `lib/places.ts`, phone side `lib/geofence.ts` |
| Repeating place reminder | `place.repeat` / `place.days`, `place.lastFiredAt` | `ringNow` / `afterCrossing` in `lib/places.ts` |
| Saved places | AsyncStorage `mnemo-places` (not SQLite) | `lib/place-store.ts` |
| Relationships | (a) **auto-filing**: a capture's entry is *moved into* another thread (`lib/filing.ts` decides, `lib/capture.ts` acts); (b) **suggestions** (`Entry.filing.by = 'suggested'`); (c) **related threads** (read-only search, `lib/search.ts`) | capture pipeline + UI |

Lifecycles traced:

* **Place reminder**: capture text → `readPlaceReminder` (`lib/places.ts`) →
  `saveNote` puts `place` on the new thread (or on the thread being added to) →
  store persists → `PlaceReminderSync` debounces → `syncGeofences` registers
  *one region per saved place* that has an armed reminder (identifier = place id,
  all regions in one `startGeofencingAsync` call) → Android geofence transition →
  `lib/geofence-task.ts` (headless) → `handleGeofenceEvent` reads all threads
  from SQLite, runs `onPlaceEvent` for every armed thread on that place →
  `fire` → `ringNow` → `ringPlaceReminder` (notification with
  `{ itemId }`, reminder category with Done / In an hour / Reply) → state saved
  (`firedAt` for one-shot; `lastFiredAt` + side for repeating). While the app
  is open, `watchWhileOpen`/`catchUp` do the same from GPS fixes.
* **Restart**: threads reload from SQLite; `syncGeofences` re-registers once per
  launch. After a reboot, expo-task-manager's `BOOT_COMPLETED` receiver restores
  the geofencing task natively (verified in
  `node_modules/expo-task-manager/android/.../AndroidManifest.xml` and
  `TaskService.restoreTasks`).
* **Notification "Done"**: `components/ReminderActions.tsx` — the same handler
  for time *and* place notifications.

## 2. Problems found, with root causes

### P1. Auto-filing merges or silently drops place reminders (issue 3, primary cause)

A thread has a single `place` slot. When the relationship engine decides a
capture belongs to another thread (`decision.action === 'attach'`), the
capture's own thread is deleted (`removeThreadNow`) and its reminders are
"carried" to the target:

```ts
// lib/capture.ts (before)
if (emptied?.place && !emptied.place.firedAt && !(target.place && !target.place.firedAt)) {
  store.updateItem(target.id, { place: emptied.place });
}
```

* Target already has a place reminder → the new one is **discarded without a
  word** (Note B "when I arrive at Tongi" is filed into Note A; Tongi never
  rings).
* For voice notes the place is only read after transcription, and
  `remindFromSound(target.id)` then **overwrites** the target's reminder
  (Location A's reminder is replaced by Tongi's; A never rings).
* Undoing the auto-file ("disconnect") calls `moveEntryToNewThread`, which
  creates a thread *without* the reminder: the reminder does not come back.

Same root cause, other entry points that silently delete a reminder: moving a
thread's only note elsewhere (`MoveSheet`, "Move there" on a suggestion, the
"Part of X? · Move" toast, "Kept apart · Undo") each re-implement
"move, then `removeThreadNow` if empty" and **never carry any reminder** — the
emptied thread is deleted with its place and time reminders. And
`saveNote(threadId)` (add to a thread, focus captures, notification Reply)
overwrites the thread's `place` with a different one.

Root cause: relationship operations (filing/moving notes) were allowed to
mutate reminder ownership, with five copies of the move logic and no single
rule for what happens to a reminder when its thread is folded into another.

### P2. Thread "Done" kills a repeating reminder (issue 4, primary cause)

The thread screen's primary **Done** sets `status = 'completed'`. Both
reminder systems treat a completed thread as finished for good:
`isArmed` (places) and `syncReminderForItem` (time) require `active|paused`.
So "Done" on Monday's office reminder unregisters the geofence (or cancels the
daily notification), and the thread leaves Home and the Library's open list:
"pressing Done makes the note disappear". There is no notion of *this
occurrence* being done; `status` is the only completion state and it means
"the whole thread is finished".

### P3. Notification "Done" on a place reminder changes the time reminder

`ReminderActions` handles Done the same way for every notification:
`completeNextStep` → for a non-repeating thread `afterReminder(thread)` →
**clears `dueDate`/`laterSteps`** and the next step. A place notification's Done
therefore cancels an unrelated time reminder on the same thread, and ticks off
the step of a weekday reminder (so Tuesday's notification no longer says what
to do). Nothing records that the place occurrence was handled.

### P4. Several "Done" controls, inconsistent feedback, no double-tap guard (issue 2)

On one thread screen: the primary **Done** (thread: celebration *and* toast, or
a detour to Wrap-up when the thread has history), the missed-reminder banner
**Done** (which, with a next step, is exactly the next-step check, otherwise
only clears the reminder although it asks "Done with this?"), and the next-step
check. `wrapup.tsx` re-implements the thread completion (its own celebrate +
toast). `completeItem` is not idempotent: a fast double tap re-runs it
(two celebrations, two toasts, `completedAt` moved). The primary Done is a
36 px `sm` button, below the 44 pt minimum in PRODUCT.md.

### P5. Geofence registration is assumed to succeed

`expo-location`'s Android consumer calls `GeofencingClient.addGeofences` with
**no success/failure listener**, so `startGeofencingAsync` resolves even when
Play Services rejects the request (e.g. `GEOFENCE_NOT_AVAILABLE` when Google
Location Accuracy is off). `syncGeofences` then records the list as set and
does not try again this launch. (The task's "not available" error path does
reset it, but only if Android delivers that error.)

### P6. Smaller findings

* `fire()` used `Date.now()` instead of the event's time (harmless in
  production, but the day rules couldn't be tested against an event time).
* A repeating "arrive" reminder only re-arms after an *exit* is seen. If
  Android drops the exit (Doze, OEM battery savers), the next day's arrival is
  read as "already inside" and doesn't ring. The app catches this when opened
  away from the place (`catchUp`), but not in the background. Not changed: a
  heuristic fix would ring falsely when a phone reboots at the place (e.g.
  overnight auto-restart at home), which is worse. Listed under limitations.
* Completing a thread doesn't touch other threads or their reminders
  (checked: `updateItem` only writes the one row; geofence regions are per
  place, and every armed thread on a shared place is handled independently).
* Geofences are not overwritten by later reminders: one region per place id, the
  whole list re-sent on every change, stale regions removed by the same call.

### Audit checklist answers

1. Duplicates: five copies of "move a note, drop the emptied thread"; two thread
   completion implementations (thread screen, Wrap-up); banner Done ≡ step check.
2. Conflicting transitions: `status='completed'` used as "occurrence done" by
   users but means "stop all reminders"; notification Done on a place reminder
   runs the time reminder's transition.
3. Shared fields: the single `place` slot is written by capture, auto-filing,
   voice re-reading and the editor; `nextStep` doubles as the place reminder's
   text when `place.step` is empty.
4. Implicit dependencies: reminders depend on which thread an entry is filed
   in (P1); place notifications depend on time-reminder logic (P3).
5. Async: background task writes SQLite while the store holds memory copies
   (reconciled by `onPlaceReminderChange`); fixes arriving together are deduped
   by `rung`. No new race found that needed a fix.
6. Restart: reminders are in SQLite, geofences re-set each launch and restored
   on boot natively. OK.
7. Validation/errors: P5; `ringDays` and `valid()` already sanitise stored JSON.
8. Delete/complete/link: delete has a 5 s undo and re-sync; complete → P2;
   link/move → P1.
9. Tests: good unit coverage of `lib/places.ts` rules and filing decisions;
   none for reminder ownership across filing, the geofence event handler,
   occurrence completion, or completion idempotency.

## 3. Plan (smallest corrections, no new tables)

1. **One rule for reminders when notes are connected** (`lib/reminder-ownership.ts`):
   auto-filing never folds a capture that owns a place reminder or a repeating
   reminder into another thread — it suggests instead; a manual move of a
   thread's last note carries its reminders when the target has room and is
   refused, with a reason, when it would overwrite one. One store method,
   `fileEntry`, used by every move path. Adding a note with a *different* place
   reminder to a thread that has one starts its own thread.
2. **Occurrences for repeating reminders**: add optional `PlaceReminder.doneAt`
   (JSON field, no migration). "Done" on a repeating thread completes the
   current occurrence only; finishing the thread for good is a separate,
   explicit menu action.
3. **Place notifications carry `place: true`**; their Done completes the place
   occurrence only.
4. **One completion path**: idempotent `completeItem`, one hook
   (`useCompleteThread`) for feedback (celebration for real tasks, otherwise a
   haptic, plus one Undo toast), used by the thread screen and Wrap-up; one
   primary 44 pt Done; the missed-reminder banner gets Tomorrow / Dismiss.
5. **Don't record a geofence list that Android will reject** (network location
   off), so it is set again as soon as it can work.
6. Tests for each of the above, including the background event handler with
   two connected place reminders.

## 4. What changed

| Finding | Change | Where |
|---|---|---|
| P1 | One ownership rule: `mayAutoFile`, `foldReminders`, `replacesPlaceReminder`, `withReminders` (moved from capture). `decideFiling({ ownsReminder })` turns an attach into a suggestion. Store `fileEntry` replaces the five move-then-drop copies; `moveEntryToNewThread` hands an emptied thread's reminders over. `saveNote` and voice re-reading start a separate thread instead of overwriting a different place reminder. | `lib/reminder-ownership.ts`, `lib/filing.ts`, `lib/capture.ts`, `hooks/use-mnemo-store.tsx`, `components/thread/MoveSheet.tsx`, `components/FilingNotifier.tsx`, `app/(tabs)/context.tsx` |
| P2 | `PlaceReminder.doneAt` + `occurrenceOf` / `completeOccurrence`; `ringNow` skips a day already done. The thread's Done on a repeating reminder = "Done for today"; finishing the thread is "Finish thread and its reminders" in ⋯. On a repeating time reminder Done no longer ticks the step off (that erased it for every later day). | `types/mnemo.ts`, `lib/places.ts`, `app/(tabs)/context.tsx`, `components/thread/PlaceReminderField.tsx` |
| P3 | Place notifications carry `kind: 'place'`; Done → `completePlaceOccurrence` only, "In an hour" → one extra nudge, no change to the thread's time reminder. Done on a repeating time reminder only dismisses. | `lib/geofence.ts`, `components/ReminderActions.tsx` |
| P4 | Idempotent `completeItem`; `useCompleteThread` + `completionFeedback` used by the thread screen and Wrap-up; primary 44 pt Done; banner is Tomorrow / Dismiss. | `hooks/use-complete-thread.ts`, `lib/done.ts`, `app/wrapup.tsx`, `app/(tabs)/context.tsx` |
| P5 | Network location checked before registering; not recorded (so retried) when off. | `lib/geofence.ts` |
| P6 | `fire` uses the event's time. Exit-drop: documented below. | `lib/geofence.ts` |

Data model: one optional field, `PlaceReminder.doneAt`, inside the existing
`items.place` JSON column. No migration; records without it read as "not done"
and behave exactly as before. Backups carry it with the rest of `place`.

Tests: `tests/place-occurrence.test.ts`, `tests/reminder-ownership.test.ts`,
`tests/geofence-pipeline.test.ts` (background handler and registration with
the OS mocked), `tests/filing-reminders.test.ts` (capture pipeline with the
relationship engine), `tests/done.test.ts` (feedback). The bug scenarios were
checked to fail against the previous `lib/capture.ts` and `lib/geofence.ts`.

### Known limitations

* A repeating "arrive" reminder re-arms only after Android reports leaving (or
  the app, opened away from the place, sees it). A dropped exit can still skip
  the next day's ring in the background (P6).
* A repeating *time* reminder's occurrences are not stored: "Done for today" on
  such a thread confirms and changes nothing, so it isn't greyed out afterwards.
* Undoing an auto-file of a note with a one-off time reminder leaves that
  reminder queued on the other thread (unchanged from before; place and
  repeating reminders are no longer auto-filed at all).
* The store's `fileEntry` / `completeItem` are exercised through their pure rules
  and an in-memory store; the React provider itself has no test harness here.

## 5. Manual test plan (Android device, release or dev build)

Setup: Settings → Location: place reminders on, location "Allow all the time",
Google Location Accuracy on, Mnemo exempt from battery optimisation. Save two
places at least 1 km apart (A and B). Geofence timing on Android varies from
seconds to a few minutes; walk well past the circle edge (≥ 200 m) before
counting a miss.

1. **Isolation.** Capture "Remind me when I arrive at A" and, separately,
   "Remind me when I arrive at B". If the second shows "Part of …?", leave it.
   Both threads show their own place line. Go to A: only A's notification.
   Go to B: only B's.
2. **Connect / disconnect.** On B tap "Move there" (to A): expect the toast
   "Not moved: … has its own place reminder". Tap "Keep separate". Both still
   ring at their places.
3. **Edit one.** Change A's reminder to "When you leave A". B's line is
   unchanged; B still rings on arrival.
4. **Restart.** Swipe Mnemo away, reboot the phone, don't open Mnemo. Arrive at
   A: it should ring (expo-task-manager restores geofences on boot; some OEMs
   block this — note the model if it doesn't).
5. **Weekday reminder.** "Remind me to log in when I get to the office on
   weekdays". Day 1: arrive → rings → tap the notification's Done → the thread
   shows "Done for today" and stays on Home. Leave. Day 2: arrive → rings
   again. Day 3: tap "Done for today" on the thread *before* arriving → no ring
   that day. Day 4: rings.
6. **Finish for good.** ⋯ → "Finish thread and its reminders": the thread
   moves to Done, the place line disappears, no ring next day. Reopen: it
   rings again on the next weekday arrival.
7. **Single completion.** On a one-off task thread, double-tap Done quickly:
   one celebration, one "is done" toast; Undo restores it.
8. **Place Done vs time reminder.** Give a thread both a time reminder
   tomorrow and a place reminder. Ring the place one, tap Done on the
   notification: tomorrow's time reminder is still listed on the thread.
9. **Registration failure.** Turn Google Location Accuracy off, open Mnemo
   (the Location card warns), turn it back on, return to Mnemo; then visit A:
   it rings.
