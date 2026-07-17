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

  /** User-authored: what to do next. Works offline. */
  nextStep?: string;

  /** User-authored: where they stopped. Works offline. */
  whereLeftOff?: string;

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
