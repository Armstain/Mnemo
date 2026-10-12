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
