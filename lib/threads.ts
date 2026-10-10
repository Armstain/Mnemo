import type { Block, ChecklistItem, Entry, MnemoItem } from '@/types/mnemo';

// Pure helpers for threads and their entries. No storage, no React — the
// store (hooks/use-mnemo-store.tsx) and the database migration both build
// on these, so the rules for "what a thread's text is" live in one place.

export function generateEntryId(): string {
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

/** Newest first — the order threads show their timeline in. */
export function newestFirst(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.createdAt - a.createdAt);
}

/** The readable text of one entry: prose, checklist items and link titles. */
export function entryText(entry: Pick<Entry, 'blocks'>): string {
  return entry.blocks
    .map((block) => {
      switch (block.kind) {
        case 'text':
          return block.markdown;
        case 'checklist':
          return block.items.map((i) => i.text).join('\n');
        case 'chart':
          return block.title;
        case 'link':
          return [block.title, block.summary, block.url].filter(Boolean).join(' ');
      }
    })
    .filter((t) => t && t.trim())
    .join('\n\n');
}

/**
 * The thread-level cache derived from its entries (see the MnemoItem doc
 * comment). Text is newest entry first, so previews show what changed
 * last; checklist items and links are gathered from every entry.
 */
export function deriveThreadCache(
  entries: Entry[],
): Pick<MnemoItem, 'content' | 'checklistItems' | 'links' | 'type'> {
  const ordered = newestFirst(entries);
  const textParts: string[] = [];
  const checklist: ChecklistItem[] = [];
  const links: string[] = [];

  for (const entry of ordered) {
    for (const block of entry.blocks) {
      if (block.kind === 'text' && block.markdown.trim()) textParts.push(block.markdown.trim());
      if (block.kind === 'checklist') checklist.push(...block.items);
      if (block.kind === 'link' && !links.includes(block.url)) links.push(block.url);
    }
  }

  const oldest = ordered[ordered.length - 1];
  return {
    content: textParts.join('\n\n'),
    checklistItems: checklist.length > 0 ? checklist : undefined,
    links,
    type: checklist.length > 0 ? 'checklist' : oldest?.source === 'voice' ? 'voice' : 'note',
  };
}

/** Text + checklist + link blocks, in that order, skipping empty ones. */
export function buildBlocks(input: {
  text?: string;
  checklistItems?: ChecklistItem[];
  links?: string[];
}): Block[] {
  const blocks: Block[] = [];
  const text = input.text?.trim();
  if (text) blocks.push({ kind: 'text', markdown: text });
  if (input.checklistItems && input.checklistItems.length > 0) {
    blocks.push({ kind: 'checklist', items: input.checklistItems });
  }
  for (const url of input.links ?? []) {
    if (url.trim()) blocks.push({ kind: 'link', url: url.trim() });
  }
  return blocks;
}

/**
 * The one entry an existing pre-threads note becomes. Keyed off the item's
 * id so re-running the migration can never create a second copy.
 */
export function entryFromLegacyItem(item: MnemoItem): Entry {
  return {
    id: `${item.id}-e0`,
    threadId: item.id,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    source: item.type === 'voice' ? 'voice' : 'text',
    blocks: buildBlocks({
      // A still-pending voice note's content is the "Transcribing…"
      // placeholder, not something the user said.
      text: item.pending && item.pendingAudioUri ? undefined : item.content,
      checklistItems: item.checklistItems,
      links: item.links,
    }),
    leftOff: item.whereLeftOff,
    nextStep: item.nextStep,
    filing: { by: 'user' },
    pending: item.pending,
    pendingRawText: item.pendingRawText,
    pendingAudioUri: item.pendingAudioUri,
  };
}
