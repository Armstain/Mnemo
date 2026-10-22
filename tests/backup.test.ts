import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupError,
  autoBackupDue,
  autoBackupName,
  autoBackupsToDelete,
  backupFingerprint,
  backupNudge,
  isAutoBackupName,
  mergeBackup,
  nameFromUri,
  openBackup,
  sealBackup,
} from '@/lib/backup';

const bytes = (n: number) => new Uint8Array(randomBytes(n));
const item = (id: string, updatedAt: number, title = id) =>
  ({ id, title, content: '', type: 'note', category: 'general', tags: [], links: [], status: 'active', createdAt: 1, updatedAt }) as never;

describe('encrypted backups', () => {
  it('round trip, Bangla intact, wrong passphrase refused', async () => {
    const payload = { app: 'mnemo' as const, exportedAt: 1, items: [item('a', 1, 'ঢাকা ট্যুর')], entries: [] };
    const file = await sealBackup(payload, 'mango tree 42', bytes);
    expect(file).not.toContain('ঢাকা');
    expect((await openBackup(file, 'mango tree 42')).items[0]).toMatchObject({ title: 'ঢাকা ট্যুর' });
    await expect(openBackup(file, 'wrong pass')).rejects.toBeInstanceOf(BackupError);
  });

  it('merging never deletes, and the newer copy wins', () => {
    const merged = mergeBackup(
      { items: [item('a', 5, 'mine'), item('b', 1)], entries: [] },
      { app: 'mnemo', exportedAt: 1, items: [item('a', 3, 'older'), item('c', 1)], entries: [] },
    );
    const titles = Object.fromEntries(merged.items.map((i: { id: string; title: string }) => [i.id, i.title]));
    expect(titles).toEqual({ a: 'mine', b: 'b', c: 'c' });
    expect(merged.added).toBe(1);
  });
});

const DAY = 24 * 60 * 60 * 1000;

describe('automatic backups', () => {
  it('names a file by the second, so a run never writes over another', () => {
    const name = autoBackupName(new Date(2026, 9, 22, 9, 5, 7));
    expect(name).toBe('mnemo-auto-2026-10-22-090507.mnemo');
    expect(isAutoBackupName(name)).toBe(true);
    expect(isAutoBackupName('mnemo-backup-2026-10-22.mnemo')).toBe(false);
    expect(isAutoBackupName('mnemo-auto-2026-10-22-090507 (1).mnemo')).toBe(false);
  });

  it('reads the file name out of a folder-picker URI', () => {
    const tree = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2FMnemo';
    expect(nameFromUri(tree)).toBe('Mnemo');
    expect(nameFromUri(`${tree}/document/primary%3ADocuments%2FMnemo%2Fmnemo-auto-2026-10-22-090507.mnemo`)).toBe(
      'mnemo-auto-2026-10-22-090507.mnemo',
    );
    expect(nameFromUri('content://com.android.externalstorage.documents/tree/primary%3Amnemo-auto-2026-10-22-090507.mnemo')).toBe(
      'mnemo-auto-2026-10-22-090507.mnemo',
    );
    // An opaque id matches no Mnemo name, so the file is never deleted.
    expect(isAutoBackupName(nameFromUri('content://com.example.cloud/document/8812'))).toBe(false);
  });

  it('keeps the last week, then the newest of each earlier month, and nothing it did not write', () => {
    const daily = Array.from({ length: 10 }, (_, i) => `mnemo-auto-2026-10-${String(22 - i).padStart(2, '0')}-120000.mnemo`);
    const monthly = ['2026-09-30', '2026-09-02', '2026-08-15', '2026-07-01', '2026-06-01', '2026-05-01', '2026-04-01', '2026-03-01'].map(
      (d) => `mnemo-auto-${d}-120000.mnemo`,
    );
    const theirs = ['holiday.jpg', 'mnemo-backup-2026-01-01.mnemo'];
    const gone = autoBackupsToDelete([...theirs, ...monthly, ...daily]);
    // Oct 16–22 are the last week. Of the older ones, Oct 15 stands for October; 13–14 go.
    expect(gone).not.toContain('mnemo-auto-2026-10-16-120000.mnemo');
    expect(gone).not.toContain('mnemo-auto-2026-10-15-120000.mnemo');
    expect(gone).toContain('mnemo-auto-2026-10-14-120000.mnemo');
    expect(gone).toContain('mnemo-auto-2026-10-13-120000.mnemo');
    // Then the newest of each month, six months in all (Oct, Sep, Aug, Jul, Jun, May).
    expect(gone).toContain('mnemo-auto-2026-09-02-120000.mnemo');
    expect(gone).not.toContain('mnemo-auto-2026-09-30-120000.mnemo');
    expect(gone).not.toContain('mnemo-auto-2026-05-01-120000.mnemo');
    expect(gone).toContain('mnemo-auto-2026-04-01-120000.mnemo');
    expect(gone.some((n) => theirs.includes(n))).toBe(false);
    expect(autoBackupsToDelete(daily.slice(0, 5))).toEqual([]);
  });

  it('is due once a day, only when notes changed, and never with no threads', () => {
    const fp = backupFingerprint([{ updatedAt: 5 }], [{ updatedAt: 9 }]);
    expect(fp).not.toBe(backupFingerprint([{ updatedAt: 5 }], [{ updatedAt: 10 }]));
    expect(fp).not.toBe(backupFingerprint([{ updatedAt: 5 }, { updatedAt: 1 }], [{ updatedAt: 9 }]));
    const now = 100 * DAY;
    expect(autoBackupDue({}, fp, 1, now)).toBe(true);
    expect(autoBackupDue({ lastAt: now - 2 * 3600_000, lastFingerprint: 'old' }, fp, 1, now)).toBe(false);
    expect(autoBackupDue({ lastAt: now - DAY, lastFingerprint: 'old' }, fp, 1, now)).toBe(true);
    expect(autoBackupDue({ lastAt: now - 9 * DAY, lastFingerprint: fp }, fp, 1, now)).toBe(false);
    expect(autoBackupDue({}, backupFingerprint([], []), 0, now)).toBe(false);
  });

  it('Home brings backups up only when notes are at risk', () => {
    const now = 100 * DAY;
    const base = { threads: 12, autoOn: false, autoAvailable: true, now };
    expect(backupNudge(base)).toBe('turn-on');
    expect(backupNudge({ ...base, autoAvailable: false })).toBe('export');
    expect(backupNudge({ ...base, threads: 3 })).toBeNull();
    expect(backupNudge({ ...base, lastBackupAt: now - 3 * DAY })).toBeNull();
    expect(backupNudge({ ...base, lastBackupAt: now - 20 * DAY })).toBe('turn-on');
    expect(backupNudge({ ...base, dismissedAt: now - 10 * DAY })).toBeNull();
    expect(backupNudge({ ...base, dismissedAt: now - 40 * DAY })).toBe('turn-on');
    // On: quiet while it works, and through a day or two of trouble.
    expect(backupNudge({ ...base, autoOn: true, lastBackupAt: now - 40 * DAY })).toBeNull();
    expect(backupNudge({ ...base, autoOn: true, failingSince: now - DAY })).toBeNull();
    expect(backupNudge({ ...base, autoOn: true, failingSince: now - 4 * DAY, dismissedAt: now })).toBe('failing');
  });
});
