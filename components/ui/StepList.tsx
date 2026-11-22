import React from 'react';
import { Pressable } from 'react-native';
import { MotiView } from 'moti';

import { Surface } from '@/components/ui/Card';
import { DoneCheck } from '@/components/ui/DoneCheck';
import { Text } from '@/components/ui/Text';
import { useEnter } from '@/hooks/use-enter';
import { useThemeColors } from '@/hooks/use-theme';

interface StepRow {
  id: string;
  text: string;
  title: string;
}

export function StepList({
  steps,
  onOpen,
  onDone,
}: {
  steps: StepRow[];
  onOpen: (id: string) => void;
  onDone: (id: string) => void;
}) {
  const colors = useThemeColors();
  const enter = useEnter();
  return (
    <Surface className="rounded-lg overflow-hidden">
      {steps.map((s, i) => (
        <MotiView
          key={s.id}
          {...enter.row(i)}
          className="flex-row items-center pl-4 pr-3 py-3"
          style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
        >
          <Pressable onPress={() => onOpen(s.id)} className="flex-1 mr-3 active:opacity-70" accessibilityRole="button">
            <Text className="font-sans-medium text-body" style={{ color: colors.fg }} numberOfLines={2}>
              {s.text}
            </Text>
            <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
              {s.title}
            </Text>
          </Pressable>
          <DoneCheck onDone={() => onDone(s.id)} label={`Mark done: ${s.text}`} restColor={colors.accentSoft} />
        </MotiView>
      ))}
    </Surface>
  );
}
