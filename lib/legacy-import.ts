import type { LegacyContextDump, MnemoItem } from '@/types/mnemo';
import { secureStorage, storage } from '@/lib/storage';

// Pre-SQLite installs kept every note as one JSON list in AsyncStorage (and, earlier still, SecureStore).
const STORAGE_KEY_V2 = 'mnemo-items-v2';
const LEGACY_STORAGE_KEY = 'mnemo-work-contexts';

const isLegacyItem = (item: unknown): item is LegacyContextDump =>
  typeof item === 'object' && item !== null && 'title' in item && 'notes' in item && !('type' in item);

function migrateLegacyItem(legacy: LegacyContextDump): MnemoItem {
  return {
    id: legacy.id,
    type: legacy.pendingAudioUri ? 'voice' : 'note',
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

async function readSecure(key: string): Promise<string | null> {
  try {
    return await secureStorage.get(key);
  } catch {
    return null;
  }
}

function parseList(raw: string): unknown[] | null {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : null;
}

/** Pre-SQLite data in the old three-tier order, or `[]`. */
export async function readLegacyItems(): Promise<MnemoItem[]> {
  const current = await storage.get(STORAGE_KEY_V2);
  const items = current && parseList(current);
  if (items) return items as MnemoItem[];

  const secureCurrent = await readSecure(STORAGE_KEY_V2);
  const secureItems = secureCurrent && parseList(secureCurrent);
  if (secureItems) return secureItems as MnemoItem[];

  const oldest = (await storage.get(LEGACY_STORAGE_KEY)) ?? (await readSecure(LEGACY_STORAGE_KEY));
  const oldItems = oldest && parseList(oldest);
  if (oldItems) return oldItems.map((item) => (isLegacyItem(item) ? migrateLegacyItem(item) : (item as MnemoItem)));

  return [];
}

export async function clearLegacyStorage(): Promise<void> {
  for (const key of [STORAGE_KEY_V2, LEGACY_STORAGE_KEY]) {
    await storage.remove(key);
    try {
      await secureStorage.remove(key);
    } catch {
      // Nothing to clean up.
    }
  }
}
