import React from 'react';
import { MotiView } from 'moti';

import { Eyebrow } from '@/components/ui/Eyebrow';
import { useEnter } from '@/hooks/use-enter';

export function SettingsSection({
  title,
  step,
  last = false,
  children,
}: {
  title: string;
  step: number;
  last?: boolean;
  children: React.ReactNode;
}) {
  const enter = useEnter();
  return (
    <MotiView {...enter.rise(step)} className={`gap-3 ${last ? '' : 'mb-10'}`}>
      <Eyebrow className="mb-1">{title}</Eyebrow>
      {children}
    </MotiView>
  );
}
