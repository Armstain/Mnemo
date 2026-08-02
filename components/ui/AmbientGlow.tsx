import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Rect } from 'react-native-svg';

import { PALETTE, useThemeName } from '@/hooks/use-theme';

/**
 * AppBackground — the app's base surface, now with a whisper of ambient tint.
 *
 * Material 3 draws most depth from tonal elevation on surfaces themselves
 * (see Glass), not from a lit background field — but a perfectly flat fill
 * behind every screen reads sterile at full-bleed size. Two very low-opacity
 * radial washes (primary top-left, tertiary bottom-right) restore some
 * atmosphere without competing with content: non-interactive, sit under
 * everything, and are subtle enough to disappear under any surface placed
 * on top. The export keeps its historical `AmbientGlow` name so existing
 * call sites (tabs layout, onboarding, capture, dump) don't need to change.
 */
export function AmbientGlow({ children }: { children?: React.ReactNode }) {
  const theme = useThemeName();
  const colors = PALETTE[theme];
  const primaryOpacity = theme === 'dark' ? 0.16 : 0.1;
  const warmOpacity = theme === 'dark' ? 0.1 : 0.06;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <Svg style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <Defs>
          <RadialGradient id="primaryGlow" cx="18%" cy="0%" r="65%">
            <Stop offset="0%" stopColor={colors.accent} stopOpacity={primaryOpacity} />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="warmGlow" cx="100%" cy="100%" r="55%">
            <Stop offset="0%" stopColor={colors.accentWarm} stopOpacity={warmOpacity} />
            <Stop offset="100%" stopColor={colors.accentWarm} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#primaryGlow)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#warmGlow)" />
      </Svg>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
