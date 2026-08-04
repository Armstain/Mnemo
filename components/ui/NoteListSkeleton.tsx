import React from 'react';
import { View } from 'react-native';
import { MotiView } from 'moti';

import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { motion, BREATHE_DURATION } from '@/utils/motion';

export function Bone({
  width,
  height = 12,
}: {
  width: number | `${number}%`;
  height?: number;
}) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: height / 2,
        backgroundColor: colors.surfaceHigh,
      }}
    />
  );
}

/** One placeholder row, shaped like NoteRow's three text lines. */
function SkeletonRow() {
  return (
    <View className="py-3.5 border-b border-border/60" style={{ gap: 8 }}>
      <View className="flex-row items-center gap-2">
        <Bone width={6} height={6} />
        <Bone width={54} height={8} />
      </View>
      <Bone width="65%" height={14} />
      <Bone width="88%" height={11} />
    </View>
  );
}

/** Shared breathing-fade wrapper — one loop driving however many bones sit inside. */
function Breathe({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  return (
    <MotiView
      from={{ opacity: reduceMotion ? 0.7 : 0.45 }}
      animate={{ opacity: reduceMotion ? 0.7 : 1 }}
      transition={motion(
        { type: 'timing' as const, duration: BREATHE_DURATION, loop: true, repeatReverse: true },
        reduceMotion,
      )}
    >
      {children}
    </MotiView>
  );
}

/**
 * Placeholder for a NoteRow list while the store's first load is still in
 * flight. A breathing fade rather than a spinner: the row shapes are
 * already on screen, so the wait reads as "your content is arriving" —
 * predictable — instead of an unknown blank hold.
 */
export function NoteListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Breathe>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </Breathe>
  );
}

/** Placeholder for the item-detail screen, shaped like its header + summary. */
export function DetailSkeleton() {
  return (
    <Breathe>
      <View style={{ gap: 14 }}>
        <View className="flex-row items-center gap-2">
          <Bone width={64} height={20} />
        </View>
        <Bone width="80%" height={26} />
        <Bone width="50%" height={12} />
        <View style={{ gap: 8, marginTop: 8 }}>
          <Bone width="100%" height={12} />
          <Bone width="92%" height={12} />
          <Bone width="70%" height={12} />
        </View>
      </View>
    </Breathe>
  );
}
