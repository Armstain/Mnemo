import * as SQLite from 'expo-sqlite';
import type { Entry, MnemoItem } from '@/types/mnemo';
import { entryFromLegacyItem } from '@/lib/threads';

// Opened lazily and asynchronously. On web, expo-sqlite runs in a worker,
// and a synchronous open at import time times out waiting on it ("Sync
// operation timeout"), crashing the app before the first render.
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = SQLite.openDatabaseAsync('mnemo.db');
  return dbPromise;
}

let initPromise: Promise<void> | null = null;

/** Idempotent schema creation. Safe to call on every app start. */
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = getDb().then((db) => db.execAsync(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        checklistItems TEXT,
        links TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT NOT NULL,
        status TEXT NOT NULL,
        nextStep TEXT,
        whereLeftOff TEXT,
        dueDate INTEGER,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        lastResumedAt INTEGER,
        aiSummary TEXT,
        pending INTEGER,
        pendingRawText TEXT,
        pendingAudioUri TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_updatedAt ON items(updatedAt);

      CREATE TABLE IF NOT EXISTS embeddings (
        itemId TEXT PRIMARY KEY NOT NULL,
        vector BLOB NOT NULL,
        model TEXT NOT NULL,
        dims INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY NOT NULL,
        threadId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL,
        source TEXT NOT NULL,
        transcript TEXT,
        blocks TEXT NOT NULL,
        leftOff TEXT,
        nextStep TEXT,
        filing TEXT NOT NULL,
        pending INTEGER,
        pendingRawText TEXT,
        pendingAudioUri TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entries_thread ON entries(threadId, createdAt);
    `).then(() => runMigrations(db)));
  }
  return initPromise;
}

// ─── Schema versions ────────────────────────────────────────────
// PRAGMA user_version records which migrations have run, so each one
// runs exactly once per install.
//   1 — threads: items gain a `pinned` column, and every existing item
//       gets the one entry it is made of (docs/specs/threads.md).
const SCHEMA_VERSION = 1;

async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(items)');
    if (!columns.some((c) => c.name === 'pinned')) {
      await db.execAsync('ALTER TABLE items ADD COLUMN pinned TEXT');
    }
  }
  await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

/**
 * Gives every item that has no entries the single entry it is made of.
 * Runs on every launch, after any legacy import, and is a no-op once all
 * items have entries — so it covers both upgraded installs and notes that
 * arrive through the older AsyncStorage import.
 */
export async function ensureEntriesForItems(items: MnemoItem[]): Promise<Entry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ threadId: string }>('SELECT DISTINCT threadId FROM entries');
  const covered = new Set(rows.map((r) => r.threadId));
  const created: Entry[] = [];
  for (const item of items) {
    if (covered.has(item.id)) continue;
    const entry = entryFromLegacyItem(item);
    await insertEntry(entry);
    created.push(entry);
  }
  return created;
}

// Raw column shapes as SQLite returns them — JSON fields are strings,
// booleans are 0/1, absent values are null (not undefined).
interface ItemRow {
  id: string;
  type: string;
  title: string;
  content: string;
  checklistItems: string | null;
  links: string;
  category: string;
  tags: string;
  status: string;
  nextStep: string | null;
  whereLeftOff: string | null;
  dueDate: number | null;
  createdAt: number;
  updatedAt: number;
  lastResumedAt: number | null;
  aiSummary: string | null;
  pending: number | null;
  pendingRawText: string | null;
  pendingAudioUri: string | null;
  pinned: string | null;
}

function rowToItem(row: ItemRow): MnemoItem {
  return {
    id: row.id,
    type: row.type as MnemoItem['type'],
    title: row.title,
    content: row.content,
    checklistItems: row.checklistItems ? JSON.parse(row.checklistItems) : undefined,
    links: JSON.parse(row.links),
    category: row.category as MnemoItem['category'],
    tags: JSON.parse(row.tags),
    status: row.status as MnemoItem['status'],
    nextStep: row.nextStep ?? undefined,
    whereLeftOff: row.whereLeftOff ?? undefined,
    dueDate: row.dueDate ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastResumedAt: row.lastResumedAt ?? undefined,
    aiSummary: row.aiSummary ? JSON.parse(row.aiSummary) : undefined,
    pending: row.pending ? true : undefined,
    pendingRawText: row.pendingRawText ?? undefined,
    pendingAudioUri: row.pendingAudioUri ?? undefined,
    pinned: row.pinned ? JSON.parse(row.pinned) : undefined,
  };
}

function itemToParams(item: MnemoItem) {
  return {
    $id: item.id,
    $type: item.type,
    $title: item.title,
    $content: item.content,
    $checklistItems: item.checklistItems ? JSON.stringify(item.checklistItems) : null,
    $links: JSON.stringify(item.links ?? []),
    $category: item.category,
    $tags: JSON.stringify(item.tags ?? []),
    $status: item.status,
    $nextStep: item.nextStep ?? null,
    $whereLeftOff: item.whereLeftOff ?? null,
    $dueDate: item.dueDate ?? null,
    $createdAt: item.createdAt,
    $updatedAt: item.updatedAt,
    $lastResumedAt: item.lastResumedAt ?? null,
    $aiSummary: item.aiSummary ? JSON.stringify(item.aiSummary) : null,
    $pending: item.pending ? 1 : null,
    $pendingRawText: item.pendingRawText ?? null,
    $pendingAudioUri: item.pendingAudioUri ?? null,
    $pinned: item.pinned ? JSON.stringify(item.pinned) : null,
  };
}

export async function getAllItems(): Promise<MnemoItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ItemRow>('SELECT * FROM items');
  return rows.map(rowToItem);
}

export async function countItems(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM items', {});
  return row?.count ?? 0;
}

export async function insertItem(item: MnemoItem): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO items
      (id, type, title, content, checklistItems, links, category, tags, status,
       nextStep, whereLeftOff, dueDate, createdAt, updatedAt, lastResumedAt,
       aiSummary, pending, pendingRawText, pendingAudioUri, pinned)
     VALUES
      ($id, $type, $title, $content, $checklistItems, $links, $category, $tags, $status,
       $nextStep, $whereLeftOff, $dueDate, $createdAt, $updatedAt, $lastResumedAt,
       $aiSummary, $pending, $pendingRawText, $pendingAudioUri, $pinned)`,
    itemToParams(item),
  );
}

/** Bulk insert for the one-time legacy migration. Sequential to keep it simple — runs once, on a small dataset. */
export async function insertItems(items: MnemoItem[]): Promise<void> {
  for (const item of items) {
    await insertItem(item);
  }
}

// Columns updateItem is allowed to touch. Used both as a whitelist (so the
// dynamic SET clause never interpolates anything but a known column name)
// and to look up how each value needs to be serialized for storage.
const JSON_COLUMNS = new Set(['checklistItems', 'links', 'tags', 'aiSummary', 'pinned']);
const BOOLEAN_COLUMNS = new Set(['pending']);
const COLUMN_KEYS = new Set([
  'type', 'title', 'content', 'checklistItems', 'links', 'category', 'tags', 'status',
  'nextStep', 'whereLeftOff', 'dueDate', 'createdAt', 'updatedAt', 'lastResumedAt',
  'aiSummary', 'pending', 'pendingRawText', 'pendingAudioUri', 'pinned',
]);

function serializeColumnValue(key: string, value: unknown): string | number | null {
  if (value === undefined || value === null) return null;
  if (JSON_COLUMNS.has(key)) return JSON.stringify(value);
  if (BOOLEAN_COLUMNS.has(key)) return value ? 1 : null;
  return value as string | number;
}

/**
 * Writes only the columns present in `updates` — mirrors how the store's
 * in-memory `{ ...item, ...updates }` merge behaves, without needing to
 * read the merged item back first.
 */
export async function updatePartialItem(id: string, updates: Partial<MnemoItem>): Promise<void> {
  const keys = Object.keys(updates).filter((k) => COLUMN_KEYS.has(k));
  if (keys.length === 0) return;

  const setClause = keys.map((k) => `${k} = $${k}`).join(', ');
  const params: Record<string, string | number | null> = { $id: id };
  for (const k of keys) {
    params[`$${k}`] = serializeColumnValue(k, (updates as Record<string, unknown>)[k]);
  }

  const db = await getDb();
  await db.runAsync(`UPDATE items SET ${setClause} WHERE id = $id`, params);
}

export async function deleteItemRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM items WHERE id = $id', { $id: id });
  await db.runAsync('DELETE FROM entries WHERE threadId = $id', { $id: id });
  await deleteEmbedding(id);
}

/** Wipes every item, entry and embedding. Used by "Clear all data" in Settings. */
export async function deleteAllItems(): Promise<void> {
  const db = await getDb();
  await db.execAsync('DELETE FROM items; DELETE FROM entries; DELETE FROM embeddings;');
}

// ─── Entries ────────────────────────────────────────────────────

interface EntryRow {
  id: string;
  threadId: string;
  createdAt: number;
  updatedAt: number;
  source: string;
  transcript: string | null;
  blocks: string;
  leftOff: string | null;
  nextStep: string | null;
  filing: string;
  pending: number | null;
  pendingRawText: string | null;
  pendingAudioUri: string | null;
}

function rowToEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    threadId: row.threadId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    source: row.source as Entry['source'],
    transcript: row.transcript ?? undefined,
    blocks: JSON.parse(row.blocks),
    leftOff: row.leftOff ?? undefined,
    nextStep: row.nextStep ?? undefined,
    filing: JSON.parse(row.filing),
    pending: row.pending ? true : undefined,
    pendingRawText: row.pendingRawText ?? undefined,
    pendingAudioUri: row.pendingAudioUri ?? undefined,
  };
}

function entryToParams(entry: Entry) {
  return {
    $id: entry.id,
    $threadId: entry.threadId,
    $createdAt: entry.createdAt,
    $updatedAt: entry.updatedAt,
    $source: entry.source,
    $transcript: entry.transcript ?? null,
    $blocks: JSON.stringify(entry.blocks),
    $leftOff: entry.leftOff ?? null,
    $nextStep: entry.nextStep ?? null,
    $filing: JSON.stringify(entry.filing),
    $pending: entry.pending ? 1 : null,
    $pendingRawText: entry.pendingRawText ?? null,
    $pendingAudioUri: entry.pendingAudioUri ?? null,
  };
}

export async function getAllEntries(): Promise<Entry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<EntryRow>('SELECT * FROM entries');
  return rows.map(rowToEntry);
}

/** Insert or replace — entries are small, so writes always send the whole row. */
export async function insertEntry(entry: Entry): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO entries
      (id, threadId, createdAt, updatedAt, source, transcript, blocks, leftOff, nextStep,
       filing, pending, pendingRawText, pendingAudioUri)
     VALUES
      ($id, $threadId, $createdAt, $updatedAt, $source, $transcript, $blocks, $leftOff, $nextStep,
       $filing, $pending, $pendingRawText, $pendingAudioUri)`,
    entryToParams(entry),
  );
}

export async function deleteEntryRow(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM entries WHERE id = $id', { $id: id });
}

// ─── Embeddings ─────────────────────────────────────────────────
// One vector per item, stored as a raw BLOB (Float32Array bytes) rather
// than JSON — a fraction of the size and no parse cost. `model`/`dims` are
// kept alongside so a future embedding-model change can detect and
// re-embed stale vectors instead of silently comparing incompatible ones.

export interface EmbeddingRecord {
  itemId: string;
  vector: Uint8Array;
  model: string;
  dims: number;
}

interface EmbeddingRow {
  itemId: string;
  vector: Uint8Array;
  model: string;
  dims: number;
  updatedAt: number;
}

export async function upsertEmbedding(record: EmbeddingRecord): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO embeddings (itemId, vector, model, dims, updatedAt)
     VALUES ($itemId, $vector, $model, $dims, $updatedAt)
     ON CONFLICT(itemId) DO UPDATE SET
       vector = $vector, model = $model, dims = $dims, updatedAt = $updatedAt`,
    {
      $itemId: record.itemId,
      $vector: record.vector,
      $model: record.model,
      $dims: record.dims,
      $updatedAt: Date.now(),
    },
  );
}

export async function getAllEmbeddings(): Promise<EmbeddingRow[]> {
  const db = await getDb();
  return db.getAllAsync<EmbeddingRow>('SELECT * FROM embeddings');
}

/** IDs that already have a vector — used to find what the backfill sweep still needs to embed. */
export async function getEmbeddedItemIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ itemId: string }>('SELECT itemId FROM embeddings');
  return new Set(rows.map((r) => r.itemId));
}

export async function deleteEmbedding(itemId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM embeddings WHERE itemId = $itemId', { $itemId: itemId });
}

export async function countEmbeddings(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) as count FROM embeddings', {});
  return row?.count ?? 0;
}
