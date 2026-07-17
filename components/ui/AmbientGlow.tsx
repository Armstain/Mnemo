import React from 'react';
import { Dimensions, StyleSheet, View, ViewStyle } from 'react-native';
import { MotiView } from 'moti';
import Svg, { Ellipse, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { PALETTE, useThemeName } from '@/hooks/use-theme';

const { width: W, height: H } = Dimensions.get('window');

interface OrbProps {
  id: string;
  width: number;
  height: number;
  color: string;
  coreOpacity: number;
  position: ViewStyle;
  drift: { x: number; y: number; duration: number };
  reduceMotion: boolean;
}

function Orb({
  id,
  width,
  height,
  color,
  coreOpacity,
  position,
  drift,
  reduceMotion,
}: OrbProps) {
  // Many stops with an ease-out curve — a 3-stop radial gradient shows a
  // visible edge on dark backgrounds; this falls off like real light.
  const gradient = (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" rx="50%" ry="50%">
          <Stop offset="0%" stopColor={color} stopOpacity={coreOpacity} />
          <Stop offset="25%" stopColor={color} stopOpacity={coreOpacity * 0.55} />
          <Stop offset="50%" stopColor={color} stopOpacity={coreOpacity * 0.24} />
          <Stop offset="75%" stopColor={color} stopOpacity={coreOpacity * 0.08} />
          <Stop offset="100%" stopColor={color} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse
        cx={width / 2}
        cy={height / 2}
        rx={width / 2}
        ry={height / 2}
        fill={`url(#${id})`}
      />
    </Svg>
  );

  if (reduceMotion) {
    return <View style={[styles.orb, position]}>{gradient}</View>;
  }

  return (
    <MotiView
      style={[styles.orb, position]}
      from={{ translateX: 0, translateY: 0 }}
      animate={{ translateX: drift.x, translateY: drift.y }}
      transition={{ type: 'timing', duration: drift.duration, loop: true }}
    >
      {gradient}
    </MotiView>
  );
}

// Per-theme field definition. A soft emerald wash lights the top of the
// scene (text stays crisp over it because all text tones are SOLID
// colors — translucent white glyphs were what read as "glow on fonts"),
// and a second color anchors the lower half where the hero glass
// surfaces (resume card, tab bar) live.
const FIELDS = {
  dark: [
    {
      id: 'glow-emerald-top',
      color: '#2EC592',
      coreOpacity: 0.08,
      width: W * 1.8,
      height: H * 0.7,
      position: { top: -H * 0.32, left: -W * 0.35 } as ViewStyle,
      drift: { x: -W * 0.08, y: H * 0.015, duration: 26000 },
    },
    {
      id: 'glow-violet-low',
      color: '#5B54C9',
      coreOpacity: 0.07,
      width: W * 1.8,
      height: H * 0.9,
      position: { top: H * 0.62, right: -W * 0.7 } as ViewStyle,
      drift: { x: -W * 0.06, y: -H * 0.015, duration: 32000 },
    },
  ],
  light: [
    {
      id: 'glow-emerald-top',
      color: '#34D399',
      coreOpacity: 0.13,
      width: W * 1.8,
      height: H * 0.7,
      position: { top: -H * 0.32, left: -W * 0.35 } as ViewStyle,
      drift: { x: -W * 0.08, y: H * 0.015, duration: 26000 },
    },
    {
      id: 'glow-violet-low',
      color: '#8B7CF0',
      coreOpacity: 0.09,
      width: W * 1.8,
      height: H * 0.9,
      position: { top: H * 0.62, right: -W * 0.7 } as ViewStyle,
      drift: { x: -W * 0.06, y: -H * 0.015, duration: 32000 },
    },
  ],
};

/**
 * AmbientGlow — the softly-lit field the whole app sits on, in both
 * themes: a deep near-black in dark mode, a cool off-white in light.
 *
 * This is what makes glass read as glass: translucent surfaces above it
 * have actual light to refract. The colored washes are confined to the
 * lower half of the screen so header and body text always sit on the
 * plain field — never on a glow. With reduced motion the field is
 * static.
 */
export function AmbientGlow({ children }: { children?: React.ReactNode }) {
  const reduceMotion = useReduceMotion();
  const theme = useThemeName();
  const orbs = FIELDS[theme];

  return (
    <View style={[styles.root, { backgroundColor: PALETTE[theme].bg }]}>
      <View pointerEvents="none" style={styles.field}>
        {orbs.map((orb) => (
          <Orb key={`${theme}-${orb.id}`} {...orb} reduceMotion={reduceMotion} />
        ))}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  field: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  orb: {
    position: 'absolute',
  },
});
