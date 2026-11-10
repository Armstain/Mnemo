import { metricKey, type MetricSummary } from '@/lib/measures';
import type { Block, Rollup } from '@/types/mnemo';

export type MetricFix = { metric?: string; rollup?: Rollup };

/** The blocks with every measure of `summary` renamed or re-rolled, or null when none of them is in these blocks. */
export function applyMetricFix(blocks: Block[], summary: MetricSummary, fix: MetricFix): Block[] | null {
  let touched = false;
  const next = blocks.map((b) => {
    if (b.kind !== 'measures') return b;
    return {
      ...b,
      items: b.items.map((m) => {
        if (metricKey(m.metric) !== summary.key) return m;
        touched = true;
        return { ...m, ...(fix.metric ? { metric: fix.metric } : {}), ...(fix.rollup ? { rollup: fix.rollup } : {}) };
      }),
    };
  });
  return touched ? next : null;
}

