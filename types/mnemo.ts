// ─── Mnemo Core Types ───────────────────────────────────────────
// The data model for the Personal Continuity App.
// Every field works offline. AI fields are optional enhancements.

export type ItemType = 'note' | 'checklist' | 'voice';

export type Category =
  | 'work'
  | 'personal'
  | 'study'
  | 'shopping'
  | 'health'
  | 'ideas'
  | 'errands'
  | 'general';

export type ItemStatus = 'active' | 'paused' | 'completed' | 'archived';

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

/**
 * A thread's notes organised by theme, made when the person asks
 * ("Organise these notes"). Kept until they redo it.
 */
export interface ThreadOverview {
  /** When it was made: notes after this are "new since". */
  at: number;
  /** How many notes it was made from. */
  notes: number;
  themes: { title: string; points: string[]; notes: number }[];
  /** Questions or choices the notes leave open. */
  open: string[];
}

export interface LaterStep {
  at: number;
  step?: string;
}

export interface AISummary {
  leftOff: string;
  nextSteps: string[];
  resources: { name: string; url: string }[];
}

/**
 * A thread — one ongoing thing in someone's life (a passport renewal, a
 * roadmap draft). Its history lives in `Entry` rows; see docs/specs/threads.md.
 *
 * `content`, `checklistItems` and `links` here are a cache derived from the
 * thread's entries (see `deriveThreadCache` in lib/threads.ts). They keep
 * search, embeddings and list previews working on one object; entries are
 * the source of truth, and nothing should write these fields directly.
 */
export interface MnemoItem {
  id: string;
  type: ItemType;
  title: string;
  content: string;
  checklistItems?: ChecklistItem[];
  links: string[];
  category: Category;
  tags: string[];
  status: ItemStatus;

  /** What to do next — from the latest entry, unless pinned by the user. */
  nextStep?: string;

  /** Where they stopped — from the latest entry, unless pinned by the user. */
  whereLeftOff?: string;

  /** Fields the user edited on the thread, which new entries must not overwrite. */
  pinned?: { nextStep?: boolean; whereLeftOff?: boolean; title?: boolean };
  /** The reminder (dueDate) comes back: every day, week or month at that time. */
  repeat?: 'daily' | 'weekly' | 'monthly';
  /** Kept at the top of Home's "pick up where you left off". */
  starred?: boolean;
  /** When it was marked done (kept if it's reopened, replaced if it's done again). */
  completedAt?: number;
  /** "Still on it": don't call this thread quiet before then. */
  quietUntil?: number;

  /** Optional due date as Unix timestamp (ms). */
  dueDate?: number;

  laterSteps?: LaterStep[];

  createdAt: number;
  updatedAt: number;

  /** Timestamp of last time user tapped "Resume" on this item. */
  lastResumedAt?: number;

  // ─── AI Enhancement (optional) ────────────────────────────────
  aiSummary?: AISummary;
  overview?: ThreadOverview;

  /** True while the item is queued for AI processing. */
  pending?: boolean;
  pendingRawText?: string;
  pendingAudioUri?: string;
}

// ─── Entries & blocks ───────────────────────────────────────────
// One capture inside a thread. See docs/specs/threads.md.

export type EntrySource = 'voice' | 'text' | 'share';

/** How values of one measure combine across a thread. */
export type Rollup = 'sum' | 'latest' | 'average' | 'compare';

/**
 * One number someone reported: money spent, a distance, their weight, a
 * price they're comparing. The AI extracts it; the device checks it was
 * said and does all the adding up (lib/measures.ts).
 */
export interface Measure {
  /** What's tracked, reused across a thread: "spent", "ran", "weight". */
  metric: string;
  value: number;
  /** "EUR", "km", "kg", "pages", "h"; ISO 4217 for money. */
  unit?: string;
  /** What this one was: "dinner", "morning run", "Dell XPS". */
  label?: string;
  /** A group to break totals down by: "food", "transport". */
  group?: string;
  rollup: Rollup;
}

export type Block =
  | { kind: 'text'; markdown: string }
  | { kind: 'checklist'; items: ChecklistItem[] }
  | {
      kind: 'chart';
      chart: 'bar' | 'line';
      title: string;
      unit?: string;
      points: { label: string; value: number }[];
    }
  | { kind: 'measures'; items: Measure[] }
  | {
      kind: 'image';
      /** A photo kept in the app's images folder (lib/images.ts)… */
      file?: string;
      /** …or, on the web, the photo itself as a data URL. */
      src?: string;
      width: number;
      height: number;
      caption?: string;
    }
  | {
      kind: 'link';
      url: string;
      title?: string;
      site?: string;
      imageUrl?: string;
      description?: string;
      summary?: string;
      why?: string;
    };

/**
 * How an entry got into its thread. `new` is a quick capture that started
 * its own thread and may still be filed elsewhere; `focus` went to the
 * thread the person is focused on (see `focusThreadId` in the store).
 */
export type Filing =
  | { by: 'user' }
  | { by: 'focus' }
  | { by: 'auto'; confidence: number }
  | { by: 'suggested'; threadId: string; confidence: number }
  | { by: 'new' };

export interface Entry {
  id: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  source: EntrySource;
  /** What was said, typed or shared, as captured (before AI clean-up). */
  transcript?: string;
  blocks: Block[];
  /** This entry's "where you are now" / next step. */
  leftOff?: string;
  nextStep?: string;
  /** The person ticked this entry's next step off. */
  stepDone?: boolean;
  filing: Filing;
  /** True while the entry waits for AI structuring (offline, failed, in flight). */
  pending?: boolean;
  pendingRawText?: string;
  pendingAudioUri?: string;
}

// ─── Legacy type (for migration) ────────────────────────────────
export interface LegacyContextDump {
  id: string;
  title: string;
  notes: string;
  links: string[];
  createdAt: number;
  summary?: {
    leftOff: string;
    nextSteps: string[];
    resources: { name: string; url: string }[];
  };
  pending?: boolean;
  pendingRawText?: string;
  pendingAudioUri?: string;
}
