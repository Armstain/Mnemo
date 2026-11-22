import React from 'react';
import { View } from 'react-native';

import { OpenRing } from '@/components/ui/ThreadRing';
import { useThemeColors } from '@/hooks/use-theme';

export function HeroCard({
  children,
  padding = 22,
  ringOffset = -56,
  ringOpacity = 0.09,
}: {
  children: React.ReactNode;
  padding?: number;
  ringOffset?: number;
  ringOpacity?: number;
}) {
  const colors = useThemeColors();
  return (
    <View className="rounded-xl overflow-hidden" style={{ backgroundColor: colors.hero, padding }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: ringOffset, right: ringOffset, opacity: ringOpacity }}>
        <OpenRing size={220} color={colors.onHero} core={false} weight={0.11} />
      </View>
      {children}
    </View>
  );
}
