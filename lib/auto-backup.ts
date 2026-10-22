import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Directory, File } from 'expo-file-system';

import {
  autoBackupDue,
  autoBackupName,
  autoBackupsToDelete,
  backupFingerprint,
  nameFromUri,
  sealBackup,
  type BackupPayload,
} from '@/lib/backup';
import { logError } from '@/lib/errors';
import { imageBase64, imagesOf } from '@/lib/images';

// Automatic backups: once a day, when something changed, a sealed `.mnemo`
// file is written into a folder the person picked (Android's folder picker;
// the permission to write there survives restarts). The passphrase is kept
// in the phone's secure storage so it can run without asking. Each run
// writes a new file and then tidies older ones (lib/backup.ts decides
// which), so a failed write never damages a good backup.
//
// Android only: iOS gives no lasting access to a folder outside the app.

export const autoBackupAvailable = Platform.OS === 'android';

const STATE_KEY = 'mnemo-backup-state';
const PASSPHRASE_KEY = 'mnemo_auto_backup_passphrase';

export interface BackupState {
  /** The picked folder (a content:// tree URI). Set while automatic backups are on. */
  folderUri?: string;
  folderName?: string;
  lastAt?: number;
  lastFingerprint?: string;
  /** First failure since the last success, and what went wrong. */
  failingSince?: number;
  lastError?: string;
  /** When a backup file was last exported by hand. */
  lastManualAt?: number;
  /** "Not now" on Home's backup suggestion. */
  nudgeDismissedAt?: number;
}

let state: BackupState = {};
const listeners = new Set<() => void>();

function setState(update: Partial<BackupState>): void {
  state = { ...state, ...update };
  listeners.forEach((l) => l());
  AsyncStorage.setItem(STATE_KEY, JSON.stringify(state)).catch(() => {
    // Kept in memory for this session; saved again on the next change.
  });
}

export const backupStateReady: Promise<void> = (async () => {
  if (Platform.OS === 'web') return;
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    if (raw) state = { ...JSON.parse(raw), ...state };
    listeners.forEach((l) => l());
  } catch {
    // No saved state: backups start off.
  }
})();

export function useBackupState(): BackupState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function autoBackupOn(s: BackupState = state): boolean {
  return autoBackupAvailable && !!s.folderUri;
}

/** The latest backup of either kind. */
export function lastBackupAt(s: BackupState = state): number | undefined {
  return Math.max(s.lastAt ?? 0, s.lastManualAt ?? 0) || undefined;
}

export function noteManualBackup(): void {
  setState({ lastManualAt: Date.now() });
}

export function dismissBackupNudge(): void {
  setState({ nudgeDismissedAt: Date.now() });
}

/** Seals a payload with its photos, so a restored note is whole. */
export async function sealWithImages(payload: BackupPayload, passphrase: string): Promise<string> {
  const images: Record<string, string> = {};
  for (const block of imagesOf(payload.entries)) {
    const data = block.file ? await imageBase64(block) : undefined;
    if (block.file && data) images[block.file] = data;
  }
  const full = Object.keys(images).length > 0 ? { ...payload, images } : payload;
  return sealBackup(full, passphrase, Crypto.getRandomBytes);
}

/**
 * Opens the folder picker and keeps the folder and passphrase. Returns false
 * if the person backed out of the picker. Run `runAutoBackup(…, { force })`
 * after, so the first file is written while they watch.
 */
export async function turnOnAutoBackup(passphrase: string): Promise<boolean> {
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }
  await SecureStore.setItemAsync(PASSPHRASE_KEY, passphrase);
  const folderName = nameFromUri(folder.uri) || undefined;
  // A new folder starts a new series: the first backup is written at once.
  setState({ folderUri: folder.uri, folderName, lastAt: undefined, lastFingerprint: undefined, failingSince: undefined, lastError: undefined });
  return true;
}

/** Stops automatic backups. Files already in the folder stay there. */
export async function turnOffAutoBackup(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSPHRASE_KEY).catch(() => {});
  setState({ folderUri: undefined, folderName: undefined, failingSince: undefined, lastError: undefined });
}

export type AutoBackupResult = 'written' | 'skipped' | 'failed';

let running: Promise<AutoBackupResult> | null = null;

/**
 * Writes a backup if one is due (or now, with `force`). Never throws: a
 * failure is recorded on the state, for Settings and Home to show.
 */
export function runAutoBackup(payload: BackupPayload, opts: { force?: boolean } = {}): Promise<AutoBackupResult> {
  if (running) return running;
  running = (async (): Promise<AutoBackupResult> => {
    await backupStateReady;
    if (!autoBackupOn()) return 'skipped';
    const fingerprint = backupFingerprint(payload.items, payload.entries);
    if (!opts.force && !autoBackupDue(state, fingerprint, payload.items.length)) return 'skipped';

    const passphrase = await SecureStore.getItemAsync(PASSPHRASE_KEY);
    if (!passphrase) throw new Error('The backup passphrase is missing. Turn automatic backups on again.');
    const text = await sealWithImages(payload, passphrase);

    const folder = new Directory(state.folderUri!);
    const file = folder.createFile(autoBackupName(), 'application/octet-stream');
    try {
      file.write(text);
      // Read it back: a backup that can't be read is worse than none, because it looks fine.
      if ((await file.text()) !== text) throw new Error('The backup file did not save completely.');
    } catch (e) {
      try {
        file.delete();
      } catch {
        // Leave it; it isn't counted as a backup.
      }
      throw e;
    }

    // The backup is safe; tidying older ones is best effort (an extra file is harmless).
    try {
      const files = folder.list().filter((f): f is File => f instanceof File);
      const old = new Set(autoBackupsToDelete(files.map((f) => nameFromUri(f.uri))));
      for (const f of files) if (old.has(nameFromUri(f.uri))) f.delete();
    } catch (e) {
      logError('auto-backup tidy', e);
    }

    setState({ lastAt: Date.now(), lastFingerprint: fingerprint, failingSince: undefined, lastError: undefined });
    return 'written';
  })()
    .catch((e: unknown): AutoBackupResult => {
      logError('auto-backup', e);
      setState({
        failingSince: state.failingSince ?? Date.now(),
        lastError: problemText(e),
      });
      return 'failed';
    })
    .finally(() => {
      running = null;
    });
  return running;
}

/** What to tell the person; the full error goes to the problem log. */
function problemText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (/permission|denied|security/i.test(message)) return "Mnemo can't write to the backup folder any more. Choose it again.";
  if (/not exist|not found|no such/i.test(message)) return 'The backup folder is gone. Choose a folder again.';
  if (/space|ENOSPC/i.test(message)) return 'There is no room left for the backup.';
  if (/passphrase/i.test(message)) return message;
  return 'The last backup could not be saved.';
}
