import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { bm25Search } from '@/lib/bm25';
import { readPeriod, threadsInPeriod, totalsFor } from '@/lib/find';
import { hybridSearch } from '@/lib/search';
import { isOpenStatus, type Category, type Entry, type ItemStatus, type MnemoItem } from '@/types/mnemo';

const SEMANTIC_DEBOUNCE_MS = 300;

/** Open is active and paused together (a paused thread says so on its row). */
export type FilterStatus = 'open' | 'completed' | 'archived';

export const STATUS_FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'completed', label: 'Done' },
  { key: 'archived', label: 'Archived' },
];

const inStatus = (status: ItemStatus, filter: FilterStatus) =>
  filter === 'open' ? isOpenStatus(status) : status === filter;

export function useLibrarySearch({
  items,
  entries,
  query,
  category,
  status,
  ai,
}: {
  items: MnemoItem[];
  entries: Entry[];
  query: string;
  category: Category | 'all';
  status: FilterStatus;
  ai: boolean;
}) {
  const scopedItems = useMemo(
    () => items.filter((i) => (category === 'all' || i.category === category) && inStatus(i.status, status)),
    [items, category, status],
  );

  const deferredQuery = useDeferredValue(query);
  const { period, rest: words } = useMemo(() => readPeriod(deferredQuery), [deferredQuery]);
  const periodKey = period ? `${period.from}-${period.to}` : '';
  const inPeriod = useMemo(
    () => {
      if (!period) return scopedItems;
      const ids = threadsInPeriod(scopedItems, entries, period);
      return scopedItems.filter((i) => ids.has(i.id));
    },
    [periodKey, scopedItems, entries], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const keywordResults = useMemo(
    () => (words ? bm25Search(words, inPeriod) : [...inPeriod].sort((a, b) => b.updatedAt - a.updatedAt)),
    [words, inPeriod],
  );
  const totals = useMemo(() => (words ? totalsFor(words, entries, period) : []), [words, entries, periodKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [hybridResults, setHybridResults] = useState<MnemoItem[] | null>(null);
  const scopeKey = useMemo(() => inPeriod.map((i) => i.id).join(','), [inPeriod]);
  const inPeriodRef = useRef(inPeriod);
  useEffect(() => {
    inPeriodRef.current = inPeriod;
  }, [inPeriod]);
  useEffect(() => {
    const trimmed = words.trim();
    setHybridResults(null);
    if (!trimmed || !ai) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      const fused = await hybridSearch(trimmed, inPeriodRef.current);
      if (!cancelled) setHybridResults(fused);
    }, SEMANTIC_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [words, scopeKey, ai]);

  const ranked = hybridResults ?? keywordResults;
  const filteredItems = useMemo(() => {
    const fromTotals = new Set(totals.flatMap((t) => t.threadIds));
    if (fromTotals.size === 0) return ranked;
    const shown = new Set(ranked.map((i) => i.id));
    return [...ranked, ...inPeriod.filter((i) => fromTotals.has(i.id) && !shown.has(i.id))];
  }, [ranked, totals, inPeriod]);

  return { deferredQuery, period, words, totals, inPeriod, ranked, filteredItems };
}
