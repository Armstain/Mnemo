/**
 * Runs `task` over `items`, at most `limit` at a time, and stops starting
 * new ones once any task resolves true (a problem every item would share:
 * a spent quota, a bad key). Pure, so it's tested (tests/send-queue.test.ts).
 */
export async function runInPool<T>(items: T[], limit: number, task: (item: T) => Promise<boolean>): Promise<void> {
  const queue = [...items];
  let stop = false;
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined && !stop; item = queue.shift()) {
      if (await task(item)) stop = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, limit) }, worker));
}
