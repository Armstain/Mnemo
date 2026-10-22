import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';

import type { Entry, MnemoItem } from '@/types/mnemo';

// Encrypted backup: one `.mnemo` file holding every thread and entry,
// sealed with a passphrase only the person knows. There is no Mnemo
// server, so this file is the backup; it can be kept anywhere (Drive,
// email, another phone) because nobody can read it without the passphrase.
//
// File format (JSON, so it survives being emailed or opened by mistake):
//   { mnemo: 'backup', v: 1,
//     kdf: { alg: 'scrypt', N, r, p, salt },          key = scrypt(passphrase, salt)
//     cipher: 'xchacha20-poly1305', nonce,             authenticated: a wrong
//     data }                                           passphrase or any edit fails
// Binary fields are base64. Voice audio is never stored, so never included;
// search vectors are left out and rebuilt after import.

const FORMAT = 'backup';
const VERSION = 1;
// scrypt cost: ~16 MB of memory and a second or two on a phone. Stored in
// the file, so later versions can raise it and still open older backups.
const KDF = { N: 2 ** 14, r: 8, p: 1 } as const;
export const MIN_PASSPHRASE = 6;

export interface BackupPayload {
  app: 'mnemo';
  exportedAt: number;
  items: MnemoItem[];
  entries: Entry[];
  /** Photos in the notes, by file name, as base64 JPEG. */
  images?: Record<string, string>;
}

export type BackupErrorReason = 'not-a-backup' | 'newer-version' | 'wrong-passphrase' | 'damaged';

export class BackupError extends Error {
  reason: BackupErrorReason;
  constructor(reason: BackupErrorReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

// ─── Bytes ──────────────────────────────────────────────────────

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

// UTF-8 by hand: Hermes doesn't reliably ship TextDecoder, and Bangla text
// has to round-trip exactly.
export function utf8Encode(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  let chunk: number[] = [];
  const flush = () => {
    out += String.fromCodePoint(...chunk);
    chunk = [];
  };
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 31) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      i += 3;
    } else {
      cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      i += 4;
    }
    chunk.push(cp);
    if (chunk.length >= 4096) flush();
  }
  flush();
  return out;
}

// ─── Seal / open ────────────────────────────────────────────────

/**
 * Encrypts a payload with a passphrase. `randomBytes` is injected (expo-crypto
 * on device, Web Crypto in tests) so this module stays free of native code.
 */
export async function sealBackup(
  payload: BackupPayload,
  passphrase: string,
  randomBytes: (n: number) => Uint8Array,
): Promise<string> {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE} characters`);
  }
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = await scryptAsync(utf8Encode(passphrase.normalize('NFC')), salt, { ...KDF, dkLen: 32 });
  const sealed = xchacha20poly1305(key, nonce).encrypt(utf8Encode(JSON.stringify(payload)));
  return JSON.stringify({
    mnemo: FORMAT,
    v: VERSION,
    kdf: { alg: 'scrypt', ...KDF, salt: toBase64(salt) },
    cipher: 'xchacha20-poly1305',
    nonce: toBase64(nonce),
    data: toBase64(sealed),
  });
}

/** Opens a `.mnemo` file. Throws BackupError with a reason the UI can explain. */
export async function openBackup(fileText: string, passphrase: string): Promise<BackupPayload> {
  let file: Record<string, any>;
  try {
    file = JSON.parse(fileText);
  } catch {
    throw new BackupError('not-a-backup', "This file isn't a Mnemo backup.");
  }
  if (file?.mnemo !== FORMAT || typeof file.data !== 'string') {
    throw new BackupError('not-a-backup', "This file isn't a Mnemo backup.");
  }
  if (Number(file.v) > VERSION) {
    throw new BackupError('newer-version', 'This backup was made by a newer Mnemo. Update the app to open it.');
  }

  const { N, r, p, salt } = file.kdf ?? {};
  const key = await scryptAsync(utf8Encode(passphrase.normalize('NFC')), fromBase64(String(salt)), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    dkLen: 32,
  });
  let plain: Uint8Array;
  try {
    plain = xchacha20poly1305(key, fromBase64(String(file.nonce))).decrypt(fromBase64(file.data));
  } catch {
    // Authentication failed: the passphrase is wrong (or the file was changed).
    throw new BackupError('wrong-passphrase', "That passphrase doesn't open this backup.");
  }
  try {
    const payload = JSON.parse(utf8Decode(plain));
    if (payload?.app !== 'mnemo' || !Array.isArray(payload.items) || !Array.isArray(payload.entries)) {
      throw new Error('shape');
    }
    return payload as BackupPayload;
  } catch {
    throw new BackupError('damaged', 'This backup is damaged and could not be read.');
  }
}

// ─── Merging into what's already here ───────────────────────────

export interface MergeResult {
  items: MnemoItem[];
  entries: Entry[];
  added: number;
  updated: number;
  unchanged: number;
}

/**
 * Combines a backup with the notes already on this phone, so importing
 * never deletes anything: a thread or entry only on one side is kept, and
 * where both have it, the more recently changed copy wins.
 */
export function mergeBackup(
  current: { items: MnemoItem[]; entries: Entry[] },
  incoming: BackupPayload,
): MergeResult {
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const mergeById = <T extends { id: string; updatedAt: number }>(mine: T[], theirs: T[], count: boolean) => {
    const byId = new Map(mine.map((x) => [x.id, x]));
    for (const t of theirs) {
      if (!t || typeof t.id !== 'string') continue;
      const m = byId.get(t.id);
      if (!m) {
        byId.set(t.id, t);
        if (count) added++;
      } else if ((t.updatedAt ?? 0) > (m.updatedAt ?? 0)) {
        byId.set(t.id, t);
        if (count) updated++;
      } else if (count) {
        unchanged++;
      }
    }
    return [...byId.values()];
  };

  const items = mergeById(current.items, incoming.items, true);
  const threadIds = new Set(items.map((i) => i.id));
  // An entry is only kept if its thread exists, so nothing is left orphaned.
  const entries = mergeById(current.entries, incoming.entries, false).filter((e) => threadIds.has(e.threadId));
  return { items, entries, added, updated, unchanged };
}

export function backupFileName(now = new Date()): string {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `mnemo-backup-${d}.mnemo`;
}

// ─── Automatic backups ──────────────────────────────────────────
// lib/auto-backup.ts writes a sealed backup into a folder the person chose,
// at most once a day and only when something changed. These rules are the
// pure part (tested in tests/backup.test.ts): names, what's due, what to
// keep, and when Home should bring backups up.

const DAY_MS = 24 * 60 * 60 * 1000;
export const AUTO_EVERY_MS = DAY_MS;
const AUTO_PREFIX = 'mnemo-auto-';
const AUTO_NAME = /^mnemo-auto-(\d{4})-(\d{2})-(\d{2})-(\d{6})\.mnemo$/;
/** Every backup from the last week is kept, then one a month for half a year. */
const KEEP_DAILY = 7;
const KEEP_MONTHLY = 6;

const pad = (n: number) => String(n).padStart(2, '0');

/** A new name for every run, so an earlier file is never written over. */
export function autoBackupName(now = new Date()): string {
  const d = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `${AUTO_PREFIX}${d}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.mnemo`;
}

/**
 * A file's name from its Android folder-picker URI, which only carries the
 * provider's document id (`primary:Documents/mnemo-auto-….mnemo`, encoded).
 * Providers with opaque ids give something that matches no Mnemo name, so
 * their files are simply never tidied away.
 */
export function nameFromUri(uri: string): string {
  const last = uri.replace(/\/+$/, '').split('/').pop() ?? '';
  let id = last;
  try {
    id = decodeURIComponent(last);
  } catch {
    // Not encoded after all.
  }
  return id.slice(Math.max(id.lastIndexOf('/'), id.lastIndexOf(':')) + 1);
}

export function isAutoBackupName(name: string): boolean {
  return AUTO_NAME.test(name);
}

/**
 * Which of Mnemo's own files in the folder can go once a new one is written:
 * the newest few are kept, and the newest of each earlier month, so notes
 * lost slowly (deleted bit by bit) can still be found in an older file.
 * Anything not named by Mnemo is never touched.
 */
export function autoBackupsToDelete(names: string[]): string[] {
  const ours = names.filter(isAutoBackupName).sort().reverse(); // newest first: the names sort by time
  const keep = new Set(ours.slice(0, KEEP_DAILY));
  const months = new Set<string>();
  for (const name of ours.slice(KEEP_DAILY)) {
    const [, y, m] = AUTO_NAME.exec(name)!;
    const month = `${y}-${m}`;
    if (months.has(month) || months.size >= KEEP_MONTHLY) continue;
    months.add(month);
    keep.add(name);
  }
  return ours.filter((n) => !keep.has(n));
}

/** Changes whenever a thread or entry is added, removed or edited. */
export function backupFingerprint(items: { updatedAt: number }[], entries: { updatedAt: number }[]): string {
  let latest = 0;
  for (const x of items) latest = Math.max(latest, x.updatedAt ?? 0);
  for (const x of entries) latest = Math.max(latest, x.updatedAt ?? 0);
  return `${items.length}:${entries.length}:${latest}`;
}

export interface AutoBackupStatus {
  /** When the last automatic backup was written. */
  lastAt?: number;
  /** backupFingerprint of what that backup held. */
  lastFingerprint?: string;
}

/**
 * Due once a day, and only if the notes changed since the last one. Nothing
 * is written while there are no threads: after "Clear all data", empty
 * files would otherwise push the real backups out of the folder.
 */
export function autoBackupDue(status: AutoBackupStatus, fingerprint: string, threads: number, now = Date.now()): boolean {
  if (threads === 0) return false;
  if (status.lastFingerprint === fingerprint) return false;
  return !status.lastAt || now - status.lastAt >= AUTO_EVERY_MS;
}

export interface BackupNudgeInput {
  threads: number;
  /** Automatic backups are on (a folder and passphrase are set). */
  autoOn: boolean;
  /** Automatic backups can run on this platform. */
  autoAvailable: boolean;
  /** The latest backup of any kind: automatic, or a file exported by hand. */
  lastBackupAt?: number;
  /** When automatic backups started failing, if they are. */
  failingSince?: number;
  dismissedAt?: number;
  now?: number;
}

/** Enough threads that losing them would hurt. */
const NUDGE_MIN_THREADS = 5;
const NUDGE_AFTER_MS = 14 * DAY_MS;
const NUDGE_SNOOZE_MS = 30 * DAY_MS;
/** A day of failures can be a folder briefly offline; three is a broken setup. */
const FAILING_FOR_MS = 3 * DAY_MS;

/**
 * What Home says about backups, if anything:
 * - 'failing': automatic backups are on but haven't worked for days.
 *   Not snoozable: the person thinks they are covered.
 * - 'turn-on' / 'export': no backup for a while, so suggest one (automatic
 *   where it can run, a file by hand where it can't). "Not now" holds it
 *   off for a month.
 */
export function backupNudge(input: BackupNudgeInput): 'failing' | 'turn-on' | 'export' | null {
  const now = input.now ?? Date.now();
  if (input.autoOn) {
    return input.failingSince && now - input.failingSince >= FAILING_FOR_MS ? 'failing' : null;
  }
  if (input.threads < NUDGE_MIN_THREADS) return null;
  if (input.lastBackupAt && now - input.lastBackupAt < NUDGE_AFTER_MS) return null;
  if (input.dismissedAt && now - input.dismissedAt < NUDGE_SNOOZE_MS) return null;
  return input.autoAvailable ? 'turn-on' : 'export';
}
