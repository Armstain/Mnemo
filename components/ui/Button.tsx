import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';

import { useThemeColors } from '@/hooks/use-theme';
import { Animated, usePressScale } from '@/hooks/use-press-scale';
import { Icon, type IconName } from '@/components/ui/Icon';

type ButtonVariant = 'primary' | 'tonal' | 'quiet' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  children: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon from the shared icon set. */
  icon?: IconName;
  /** Trailing icon — usually 'arrowUpRight' or 'chevronRight'. */
  trailingIcon?: IconName;
  fullWidth?: boolean;
  /** Push label left and trailing icon right — for full-width nav-style buttons. */
  spread?: boolean;
  disabled?: boolean;
  onPress: () => void;
  className?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 52 };
const H_PADDING: Record<ButtonSize, number> = { sm: 14, md: 18, lg: 24 };
const ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 19 };
// One step larger than the surrounding caption text, so a control always
// reads as clearly as the content beside it.
const TEXT_CLASS: Record<ButtonSize, string> = {
  sm: 'text-sm',
  md: 'text-body',
  lg: 'text-body',
};

/** Primary action control. Always a pill; variant carries the weight. */
export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  trailingIcon,
  fullWidth = false,
  spread = false,
  disabled = false,
  onPress,
  className = '',
}: ButtonProps) {
  const colors = useThemeColors();
  const press = usePressScale();

  const handlePress = () => {
    if (disabled) return;
    if (variant === 'danger') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else if (variant === 'primary') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  };

  // Variant colors are conditional at runtime — uniwind's className pipeline
  // only resolves *static* class strings, so anything that varies per-prop
  // goes through inline `style` (see hooks/use-theme's doc comment).
  const { background, textColor } = (() => {
    switch (variant) {
      case 'primary':
        return { background: colors.accent, textColor: colors.accentInk };
      case 'tonal':
        return { background: colors.primaryContainer, textColor: colors.onPrimaryContainer };
      case 'quiet':
        return { background: colors.surfaceHigh, textColor: colors.fg };
      case 'danger':
        return { background: colors.errorSoft, textColor: colors.error };
      case 'ghost':
      default:
        return { background: 'transparent', textColor: colors.fgSecondary };
    }
  })();

  return (
    // The Pressable handles layout (callers pass flex-1 and friends); the
    // pill inside is what springs under the finger.
    <Pressable
      onPress={handlePress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      className={`${fullWidth ? 'w-full' : ''} ${className}`}
      style={{ opacity: disabled ? 0.42 : 1 }}
    >
      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: spread ? 'space-between' : 'center',
            gap: spread ? 0 : 8,
            height: HEIGHT[size],
            paddingHorizontal: H_PADDING[size],
            backgroundColor: background,
            borderRadius: 999,
          },
          press.style,
        ]}
      >
      {icon ? <Icon name={icon} size={ICON_SIZE[size]} stroke={2} color={textColor} /> : null}
      <Text className={`font-sans-semi ${TEXT_CLASS[size]}`} style={{ color: textColor }} numberOfLines={1}>
        {children}
      </Text>
      {trailingIcon ? (
        <View style={spread ? undefined : { marginLeft: -2 }}>
          <Icon name={trailingIcon} size={ICON_SIZE[size] - 2} stroke={2} color={textColor} />
        </View>
      ) : null}
      </Animated.View>
    </Pressable>
  );
}

type IconButtonVariant = 'default' | 'bare' | 'danger';

interface IconButtonProps {
  icon: IconName;
  /** Accessible label — required, the button has no visible text. */
  label: string;
  variant?: IconButtonVariant;
  /** Box size in px. Never below 44 for primary touch targets. */
  size?: number;
  disabled?: boolean;
  /** On (a toggle like "Pin to Home"): drawn in the accent colour. */
  active?: boolean;
  onPress: () => void;
}

/** Circular control for toolbar actions. */
export function IconButton({ icon, label, variant = 'default', size = 44, disabled = false, active = false, onPress }: IconButtonProps) {
  const colors = useThemeColors();
  const press = usePressScale(0.88);

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const { background, color } = (() => {
    if (active) return { background: variant === 'bare' ? 'transparent' : colors.accentSoft, color: colors.accent };
    switch (variant) {
      case 'bare':
        return { background: 'transparent', color: colors.fgSecondary };
      case 'danger':
        return { background: colors.errorSoft, color: colors.error };
      case 'default':
      default:
        return { background: colors.surfaceHigh, color: colors.fgSecondary };
    }
  })();

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={active ? { selected: true } : undefined}
      hitSlop={4}
      style={{ opacity: disabled ? 0.42 : 1 }}
    >
      <Animated.View
        style={[
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: background,
          },
          press.style,
        ]}
      >
        <Icon name={icon} size={Math.round(size * 0.42)} color={color} />
      </Animated.View>
    </Pressable>
  );
}
