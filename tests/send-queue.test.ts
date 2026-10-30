import { describe, expect, it } from 'vitest';
import { runInPool } from '@/lib/send-queue';

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('sending waiting notes', () => {
  it('never more than the limit at once, and every note is sent', async () => {
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await runInPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await tick();
      running--;
      done.push(n);
      return false;
    });
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('stops starting notes once one hits a problem every note would share', async () => {
    const started: number[] = [];
    await runInPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await tick();
      return n === 1; // e.g. quota spent
    });
    // The two in flight finish; the other four are never sent.
    expect(started).toEqual([1, 2]);
  });

  it('an empty queue is fine', async () => {
    await runInPool([], 2, async () => false);
  });
});
