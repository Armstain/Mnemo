import type { MnemoItem, LegacyContextDump } from '@/types/mnemo';

/**
 * Detects whether a stored item is in the legacy ContextDump format.
 * Legacy items lack the `type` field that every MnemoItem has.
 */
export function isLegacyItem(item: unknown): item is LegacyContextDump {
  return (
    typeof item === 'object' &&
    item !== null &&
    'title' in item &&
    'notes' in item &&
    !('type' in item)
  );
}

/**
 * Converts a legacy ContextDump into a MnemoItem.
 * All existing data is preserved; new fields get sensible defaults.
 */
export function migrateLegacyItem(legacy: LegacyContextDump): MnemoItem {
  const hasAudio = !!legacy.pendingAudioUri;

  return {
    id: legacy.id,
    type: hasAudio ? 'voice' : 'note',
    title: legacy.title,
    content: legacy.notes,
    links: legacy.links ?? [],
    category: 'general',
    tags: [],
    status: legacy.pending ? 'paused' : 'active',
    nextStep: legacy.summary?.nextSteps?.[0],
    whereLeftOff: legacy.summary?.leftOff,
    createdAt: legacy.createdAt,
    updatedAt: legacy.createdAt,
    aiSummary: legacy.summary
      ? {
          leftOff: legacy.summary.leftOff,
          nextSteps: legacy.summary.nextSteps,
          resources: legacy.summary.resources,
        }
      : undefined,
    pending: legacy.pending,
    pendingRawText: legacy.pendingRawText,
    pendingAudioUri: legacy.pendingAudioUri,
  };
}

/**
 * Migrates an entire array of stored items.
 * Items already in MnemoItem format pass through unchanged.
 */
export function migrateStoredData(raw: unknown[]): MnemoItem[] {
  return raw.map((item) => {
    if (isLegacyItem(item)) {
      return migrateLegacyItem(item);
    }
    return item as MnemoItem;
  });
}
