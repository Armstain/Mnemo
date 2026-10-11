# Spec: threads, smart captures and sharing in

Status: draft for review · Screens: [`threads-screens.png`](./threads-screens.png)

## Why

Today every capture becomes a separate note. Real life is one passport renewal
with ten check-ins over three weeks. Mnemo should:

1. **Grow threads.** A new capture joins the thread it belongs to, on its own
   when the match is clear, as a one-tap suggestion when it isn't.
2. **Give each capture the right shape.** One AI call turns speech into a note,
   a checklist, a small chart or a link card, whichever fits.
3. **Make saving links and articles effortless.** Share from any app into
   Mnemo; it fetches the page, summarises it, files it.

Constraint: most people use the free tier, so **one AI call per capture**,
never more, and no call ever sees more than one capture plus a short list of
open threads.

---

## 1. Data model

Threads replace the current flat `MnemoItem` list. A thread is a timeline of
entries; an entry is one capture, made of typed blocks.

```ts
interface Thread {
  id: string;
  title: string;
  category: Category;            // unchanged set: work, personal, study, …
  status: ItemStatus;            // active | paused | completed | archived
  tags: string[];
  nextStep?: string;             // from the latest entry unless the user pinned one
  whereLeftOff?: string;         // same
  pinned?: { nextStep?: boolean; whereLeftOff?: boolean };
  dueDate?: number;
  createdAt: number;
  updatedAt: number;             // = latest entry time, or last edit
  lastResumedAt?: number;
}

interface Entry {
  id: string;
  threadId: string | null;       // null = "just captured", awaiting a home
  createdAt: number;
  source: 'voice' | 'text' | 'share';
  transcript?: string;           // what was said / typed / shared, as captured
  audioUri?: string;
  blocks: Block[];
  leftOff?: string;              // this entry's "where you are now"
  nextStep?: string;
  filing: Filing;                // how it got into its thread
  pending?: boolean;             // AI not run yet (offline, failed)
}

type Filing =
  | { by: 'user' }                                           // recorded inside the thread, or moved by hand
  | { by: 'auto'; confidence: number }                       // attached automatically
  | { by: 'suggested'; threadId: string; confidence: number } // waiting on one tap
  | { by: 'new' };                                           // started its own thread

type Block =
  | { kind: 'text'; markdown: string }
  | { kind: 'checklist'; items: { id: string; text: string; checked: boolean }[] }
  | { kind: 'chart'; chart: 'bar' | 'line'; title: string; unit?: string;
      points: { label: string; value: number }[] }
  | { kind: 'link'; url: string; title?: string; site?: string; imageUrl?: string;
      description?: string; summary?: string; why?: string };
```

**SQLite.** New `threads` and `entries` tables (`entries.blocks` and `filing`
stored as JSON, indexed on `threadId` and `createdAt`). `embeddings` stays keyed
by id and gains a `kind` column (`thread` | `entry`).

**Thread embedding costs nothing extra.** It is the normalised mean of its
entries' vectors, recomputed on device whenever an entry is added or moved. No
API call.

**Where you left off** is the latest entry's `leftOff`/`nextStep`, unless the
user edited it on the thread (then `pinned` keeps their version until they
clear it).

**Migration (one-time, on launch).** Each existing item becomes a thread with
the same id plus one entry built from it: `content` → text block,
`checklistItems` → checklist block, `links` → link blocks, `nextStep` /
`whereLeftOff` copied across, `filing: { by: 'user' }`. Keeping the id means
reminders, nudges and stored embeddings keep working untouched.

---

## 2. The capture call

### Context sent with every capture

- The capture: audio, typed text, or a shared page's metadata and first ~2,000
  characters of readable text.
- **Open threads:** the 25 most recently updated non-archived threads, one line
  each: `id · title · category · next step`. About 1–1.5k tokens.
- For text and shares (where we have words before the call): the top 3 threads
  by on-device keyword search are marked as likely candidates.

If the capture was made inside a thread, the open-threads list is skipped and
the entry is filed there (`by: 'user'`).

### Response schema (Gemini structured output)

Flat, no union types, so it works with the free Flash models:

```jsonc
{
  "transcript": "string",                // voice only: faithful transcript
  "title": "string",                      // used only if this starts a new thread
  "category": "work | personal | study | shopping | health | ideas | errands | general",
  "tags": ["string"],
  "thread": {
    "match": "existing | new",
    "threadId": "string",                 // "" when new
    "confidence": 0.0,                    // 0–1
    "reason": "string"                    // one short line, shown on suggestions
  },
  "leftOff": "string",
  "nextStep": "string",
  "blocks": [{
    "kind": "text | checklist | chart | link",
    "markdown": "string",                 // text
    "items": ["string"],                  // checklist
    "chart": "bar | line",                // chart
    "title": "string", "unit": "string",
    "points": [{ "label": "string", "value": 0 }],
    "url": "string", "summary": "string", "why": "string"   // link
  }]
}
```

### Prompt rules (abridged)

- Answer in the speaker's language.
- **Checklist** only for two or more separate, doable items. Don't turn
  ordinary prose into a list.
- **Chart** only for three or more numbers the person actually said, in the
  same unit, that compare or change over time. Never estimate, convert or fill
  gaps. Bar for categories, line for time.
- **Link** block for every URL mentioned or shared; `why` is one line on why
  this person saved it, inferred from what they said.
- **Thread match:** pick an open thread only if this capture continues it (same
  task, trip, project or person, not just the same topic). Otherwise `new`.
  Confidence should reflect how sure, not how similar the words are.

### Checked on the device, not trusted

| Check | If it fails |
|---|---|
| Every chart value appears in the transcript or shared text (accepting forms like `5k`, `5,000`, `5 thousand`) | Chart is dropped; the numbers stay in the text block |
| Chart has ≥ 3 points and one unit | Dropped, as above |
| `threadId` is one of the threads we sent | Treated as `new` |
| Link URL appears in the capture | Link block dropped |
| Checklist items non-empty, deduplicated, at most 30 | Trimmed |

---

## 3. Auto-connect

After the call, the app embeds the new entry (the same single embedding call
it makes today) and compares it with the chosen thread's vector.

| Model says | And on device | Result |
|---|---|---|
| existing, confidence ≥ 0.8 | thread is in the entry's top 3 by similarity | **Attach.** Toast: *Added to Passport renewal* · Undo · Move |
| existing, 0.5–0.8, or the checks disagree | — | **Suggest.** Entry waits in *Just captured* on Home: *Add to Passport renewal?* · Add · Keep separate |
| new, or confidence < 0.5 | — | **New thread** from `title`/`category` |

- Undo and Move are always available, not only in the toast: every entry has
  *Move to thread…* (searchable picker) and threads can be merged.
- Thresholds start as constants. Accept/reject counts are kept locally so they
  can be tuned later; no automatic learning in v1.
- **Offline or AI failed:** the entry is saved with its audio or text right
  away. Voice entries land in *Just captured* with *Processing later*; text and
  shares can still be filed by hand using on-device keyword matches.

---

## 4. Sharing in

- **Share sheet:** `expo-share-intent` 5.x (the line whose peer dependency is
  Expo SDK 54; 6.x and later need newer SDKs). Accepts URLs, plain text and
  images. Needs a dev build, which the app already uses.
- **On receive, no AI:** save immediately as a `share` entry with a link block,
  then fetch the page on the device and fill `title`, `site`, `description`,
  `imageUrl` from its Open Graph / meta tags. YouTube uses its public oEmbed
  endpoint for title and channel.
- **Then the one AI call**, using the shared page's title, description and
  first ~2,000 characters of text, plus anything the person typed or said
  alongside: summary, `why`, category, tags, thread match. Same schema, same
  auto-connect rules.
- **Offline:** the link card shows whatever metadata loaded; AI runs later.

---

## 5. Screens

See `threads-screens.png`.

1. **Thread.** Header: ring, category · status, title, *Next step* pinned
   under it. Below, the timeline, newest entry first, each with its time and
   source (voice, typed, shared) and its blocks. At the bottom, *Add to this
   thread*: hold to record, tap to type. Entries made here skip matching.
2. **Blocks.** Checklist card (tick inline), chart card (small bar or line
   chart, drawn with the `react-native-svg` the app already ships), link card
   (image, site, title, the *why* line).
3. **After a capture.** Attached: a toast with Undo and Move. Suggested: a
   *Just captured* card at the top of Home with Add / Keep separate and the
   model's one-line reason.

Home keeps its layout: the resume card and rows become threads instead of
notes. Library lists threads; search covers thread titles and entry text.

---

## 6. Cost per capture

| Capture | AI calls |
|---|---|
| Voice | 1 `generateContent` (audio + ~1.5k tokens of open threads) + 1 `embedContent` |
| Typed text | same |
| Share | same; page fetch is a normal HTTP request, not AI |
| Thread vectors, left-off, summaries | 0 (computed on device) |

Same as today, plus the open-threads list in the prompt.

---

## 7. Build order

1. **Model + migration + thread screen.** No AI changes. Existing notes become
   one-entry threads; the thread screen shows the timeline; *Add to this
   thread* works with the current AI pipeline.
2. **Capture v2.** New schema and prompt, device-side checks, auto-connect with
   toast and *Just captured* suggestions, Move and Merge.
3. **Chart and link blocks** rendered properly.
4. **Share sheet.**

Each step ships on its own and leaves the app working.

---

## Open questions

1. **Timeline order:** newest entry first (proposed) or oldest first like a chat?
2. **Auto-attach from day one,** or suggest-only for the first week so people
   learn to trust it?
3. **Splitting one long ramble across several threads:** left out of v1 (it
   needs a second kind of response and a review screen). Worth planning for v2?
4. **Categories:** keep them alongside threads for browsing (proposed), or let
   threads carry tags only?
