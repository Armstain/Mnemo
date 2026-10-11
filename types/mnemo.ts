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
  pinned?: { nextStep?: boolean; whereLeftOff?: boolean };

  /** Optional due date as Unix timestamp (ms). */
  dueDate?: number;

  createdAt: number;
  updatedAt: number;

  /** Timestamp of last time user tapped "Resume" on this item. */
  lastResumedAt?: number;

  // ─── AI Enhancement (optional) ────────────────────────────────
  aiSummary?: AISummary;

  /** True while the item is queued for AI processing. */
  pending?: boolean;
  pendingRawText?: string;
  pendingAudioUri?: string;
}

/** Thread is the product name for a MnemoItem; new code should prefer it. */
export type Thread = MnemoItem;

// ─── Entries & blocks ───────────────────────────────────────────
// One capture inside a thread. See docs/specs/threads.md.

export type EntrySource = 'voice' | 'text' | 'share';

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

/** How an entry got into its thread. */
export type Filing =
  | { by: 'user' }
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
