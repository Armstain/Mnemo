import { useState } from 'react';

export function useShowMore(limit = 4) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return {
    shown: <T>(key: string, list: T[]): T[] => (open[key] ? list : list.slice(0, limit)),
    eyebrow: (key: string, count: number) =>
      count > limit
        ? { action: open[key] ? 'Fewer' : `All ${count}`, onAction: () => setOpen((o) => ({ ...o, [key]: !o[key] })) }
        : {},
  };
}
