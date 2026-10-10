import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useThemeColors } from '@/hooks/use-theme';

interface PillProps {
  children: React.ReactNode;
  /** Hex color driving fill/border/text; defaults to the theme's secondary text color. */
  tone?: string;
  size?: 'sm' | 'md';
  dot?: boolean;
  outline?: boolean;
  selected?: boolean;
  onPress?: () => void;
  className?: string;
}

const SIZE_CLASS: Record<'sm' | 'md', string> = {
  sm: 'h-[22px] px-2 gap-1.5',
  md: 'h-7 px-[11px] gap-1.5',
};

const TEXT_CLASS: Record<'sm' | 'md', string> = {
  sm: 'text-xs',
  md: 'text-xs',
};

/** Generic tone-driven chip. Callers supply the color (e.g. a category hue, `colors.accent`); this component has no built-in notion of category or status. */
export function Pill({
  children,
  tone,
  size = 'md',
  dot = true,
  outline = false,
  selected = false,
  onPress,
  className = '',
}: PillProps) {
  const colors = useThemeColors();
  const resolvedTone = tone ?? colors.fgSecondary;

  // Every color here is runtime-dynamic (tone is always a prop, never a
  // static class), so background/border/text all go through inline `style`
  // per this codebase's uniwind convention (see ZenCard, Button).
  const bg = selected ? resolvedTone : outline ? 'transparent' : `${resolvedTone}24`; // "24" hex alpha ~= 14%, matches color-mix(... 14%) from the web spec
  const fg = selected ? colors.bg : resolvedTone;
  const hasOutlineBorder = outline && !selected;

  const handlePress = () => {
    if (!onPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const content = (
    <>
      {dot && (
        <View
          style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: fg }}
        />
      )}
      <Text className={`font-sans-semi ${TEXT_CLASS[size]}`} style={{ color: fg }}>
        {children}
      </Text>
    </>
  );

  const style = {
    backgroundColor: bg,
    borderWidth: hasOutlineBorder ? 1 : 0,
    borderColor: hasOutlineBorder ? colors.border : 'transparent',
  };

  const wrapperClassName = `flex-row items-center rounded-full ${SIZE_CLASS[size]} ${className}`;

  if (onPress) {
    return (
      <Pressable onPress={handlePress} className={`${wrapperClassName} active:opacity-70`} style={style}>
        {content}
      </Pressable>
    );
  }

  return (
    <View className={wrapperClassName} style={style}>
      {content}
    </View>
  );
}
