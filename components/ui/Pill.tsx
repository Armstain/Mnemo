import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { Icon, type IconName } from '@/components/ui/Icon';
import { haptic } from '@/lib/haptics';

import { useThemeColors } from '@/hooks/use-theme';
import { Animated, usePressScale } from '@/hooks/use-press-scale';

interface PillProps {
  children: React.ReactNode;
  /** Hex color driving fill/border/text; defaults to the theme's secondary text color. */
  tone?: string;
  size?: 'sm' | 'md' | 'lg';
  /** Leading dot. Defaults to on for a status pill and off for a choice. */
  dot?: boolean;
  dotColor?: string;
  /** Leading icon, in the pill's text colour. */
  icon?: IconName;
  outline?: boolean;
  /** Passing a boolean makes this a choice chip: outlined until selected, then filled. */
  selected?: boolean;
  /** For a choice: selected is a tinted fill with a tone border, unselected a plain bordered surface. */
  soft?: boolean;
  onPress?: () => void;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<PillProps['size']>, string> = {
  sm: 'h-[22px] px-2 gap-1.5',
  md: 'h-7 px-[11px] gap-1.5',
  lg: 'h-9 px-3.5 gap-1.5',
};

/** The one chip: a status label or, with `selected`, a choice. Callers supply the colour (a category hue, `colors.accent`). */
export function Pill({
  children,
  tone,
  size = 'md',
  dot,
  dotColor,
  icon,
  outline,
  selected,
  soft = false,
  onPress,
  className = '',
}: PillProps) {
  const colors = useThemeColors();
  const press = usePressScale(0.94);
  const wasSelected = React.useRef(!!selected);
  React.useEffect(() => {
    if (selected && !wasSelected.current) press.pop();
    wasSelected.current = !!selected;
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const isChoice = selected !== undefined;
  const showDot = dot ?? !isChoice;
  const isOutline = outline ?? (isChoice && !selected);
  const resolvedTone = tone ?? colors.fgSecondary;

  const softChoice = soft && isChoice;
  const bg = softChoice
    ? selected
      ? colors.accentSoft
      : colors.surface
    : selected
      ? resolvedTone
      : isOutline
        ? 'transparent'
        : `${resolvedTone}24`;
  const fg = softChoice ? (selected ? resolvedTone : colors.fgSecondary) : selected ? colors.bg : resolvedTone;
  const iconColor = softChoice && !selected ? colors.fgTertiary : fg;
  const hasOutlineBorder = isOutline && !selected;
  const borderColor = softChoice
    ? selected
      ? `${resolvedTone}40`
      : colors.border
    : selected
      ? 'transparent'
      : hasOutlineBorder
        ? colors.border
        : 'transparent';

  const handlePress = () => {
    if (!onPress) return;
    haptic.select();
    onPress();
  };

  const content = (
    <>
      {showDot && <View style={{ width: 6, height: 6, borderRadius: 9999, backgroundColor: dotColor ?? fg }} />}
      {icon ? <Icon name={icon} size={13} color={iconColor} /> : null}
      <Text className={`font-sans-semi shrink ${size === 'lg' ? 'text-sm' : 'text-xs'}`} style={{ color: fg }} numberOfLines={1}>
        {children}
      </Text>
    </>
  );

  const style = {
    backgroundColor: bg,
    borderWidth: isChoice || hasOutlineBorder ? 1 : 0,
    borderColor,
    maxWidth: '100%' as const,
  };

  const wrapperClassName = `flex-row items-center rounded-full ${SIZE_CLASS[size]} ${className}`;

  if (onPress) {
    return (
      <Pressable
        onPress={handlePress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityState={isChoice ? { selected: !!selected } : undefined}
      >
        <Animated.View className={wrapperClassName} style={[style, press.style]}>
          {content}
        </Animated.View>
      </Pressable>
    );
  }

  return (
    <View className={wrapperClassName} style={style}>
      {content}
    </View>
  );
}
