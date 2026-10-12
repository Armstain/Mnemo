import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { BackupError, mergeBackup, openBackup, sealBackup } from '@/lib/backup';

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
