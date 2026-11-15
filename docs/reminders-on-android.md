# Reminders on Android

Reminders are local notifications scheduled with `expo-notifications`, which
sets an `AlarmManager` alarm for each one. What can stop one arriving:

| Cause | What Mnemo does |
| --- | --- |
| Android 12+ only allows **inexact** alarms without `SCHEDULE_EXACT_ALARM`; Doze can hold those back for hours. | The permission is declared (`app.json`, `modules/mnemo-reliability`). It's granted by default on Android 12–13. On 14+ the person turns on "Alarms & reminders"; the check screen opens it. |
| The reminders channel was `DEFAULT` importance: no pop-up, no sound. | Reminders use a `HIGH` channel (`reminder-alerts`); the old `reminders` channel is deleted. |
| **Xiaomi, Oppo/Realme/OnePlus, Vivo, Huawei/Honor, Infinix/Tecno/itel** battery savers stop apps in the background, block autostart (so alarms aren't restored after a restart) and turn off pop-ups for new apps. | The **reminder check** screen (Settings → Make sure reminders arrive, or a one-time card on Home on those phones) reads what it can and opens each maker's own settings screen. |
| A force stop, a restart without autostart, or exact alarms toggled all drop scheduled alarms. | Every reminder is set again when the app opens or comes back (`rearmReminders`, at most every 5 minutes), so at worst one is missed, not all. |
| None of the above is visible until a reminder doesn't come. | The check screen sends a **real test reminder** a minute out and asks the person to close the app and lock the phone. Seen in the tray or tapped = verified. Seen while the app was open doesn't count. |

What can be read (`modules/mnemo-reliability`, Android only): exact alarms,
Android's battery optimization and background restriction, and Xiaomi's
autostart (app op 10008). A maker's own battery saver and pop-up settings
can't be read; those rows say "check" and the test settles it.

## Testing on a phone

Needs a development or production build (`eas build`); Expo Go has no
reminders and doesn't include the native module.

1. Install on a Xiaomi/Redmi/POCO phone. Set a reminder on a thread.
2. Home shows "Make sure reminders reach you". Open it.
3. Each row: tap its button, check the right settings screen opens, change
   it, come back. The row should update (exact alarms, autostart, battery
   "No restrictions" if MIUI reports it).
4. Send a test reminder, swipe Mnemo away from recents, lock the phone. It
   should arrive in about a minute, as a pop-up with sound.
5. Tap it: the check screen says it works, and the Home card is gone.
6. Restart the phone with a reminder set for a few minutes later, and don't
   open Mnemo. With autostart on it arrives; with it off, it doesn't until
   Mnemo is opened (and then the others are set again).
7. On Android 14+: turn "Alarms & reminders" off, set a reminder for 2
   minutes, lock the phone; note how late it arrives. Turn it on and repeat.

Play Store: `SCHEDULE_EXACT_ALARM` needs no declaration form (unlike
`USE_EXACT_ALARM`, which is for alarm-clock and calendar apps).

## Repeats, heads-ups and the "Reminder set" notice

How a thread's reminder is laid out as alarms (`lib/reminders.ts`):

| Reminder | Alarms |
| --- | --- |
| Once | One, named by the thread's id. |
| Every day / week / month / year | One repeating alarm the phone keeps (`DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` triggers). |
| Every weekday | One `WEEKLY` alarm per working day (`:wd:<day>`); the weekend is the region's (`phoneWeekend`). |
| Every N days/weeks/months, nth weekday of the month | The next few times as one-off alarms (`:occ:<at>`), at most 12 and within 45 days, topped up by `rearmReminders` whenever the app opens. Not opened for over 45 days (or 12 times), those stop until it is. |
| Heads-ups before a one-off appointment | One-off alarms (`:lead:<at>`) in the `heads-up` category. |

A heads-up's **OK** has `opensAppToForeground: false`: expo-notifications runs
`lib/notification-task.ts` in the background, which dismisses it. To test:
set a reminder for a few minutes ahead with a "15 min" heads-up, close Mnemo,
and tap OK when it comes. It should go away without opening the app.

"Reminder set" notices go on their own quiet channel (`saved`, no sound) and
are not shown as a banner while the app is open, since the toast says the
same thing. Undo, Change and Add note open the app.
