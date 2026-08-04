import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { useThemeColors } from '@/hooks/use-theme';

interface ZenButtonProps {
  onPress: () => void;
  title: string;
  icon?: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  disabled?: boolean;
  hapticIntensity?: 'light' | 'medium' | 'heavy';
  className?: string;
}

export const ZenButton = ({
  onPress,
  title,
  icon,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  hapticIntensity = 'light',
  className = '',
}: ZenButtonProps) => {
  const colors = useThemeColors();

  const handlePress = () => {
    if (disabled) return;

    switch (hapticIntensity) {
      case 'heavy':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
      default:
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
    }

    onPress();
  };

  // Variant/size colors are conditional at runtime — uniwind's className
  // pipeline only resolves *static* class strings (see the doc comment on
  // useThemeColors), so anything that varies per-prop has to go through
  // inline `style`, matching every other themed component in the app
  // (CategoryPill, NoteRow, FloatingTabBar).
  const backgroundColor = (() => {
    switch (variant) {
      case 'primary':
        return colors.accent;
      // Same tonal fill as the Settings screen's secondary actions
      // ("Test Key", theme picker) — filled, not a transparent outline.
      case 'secondary':
      case 'outline':
        return colors.surfaceWarm;
      case 'danger':
        return colors.error;
      case 'ghost':
      default:
        return 'transparent';
    }
  })();

  const textColor = (() => {
    switch (variant) {
      // Ink tokens pair with the fill per theme (dark ink on the bright
      // dark-theme fills, white on the deep light-theme fills).
      case 'primary':
        return colors.accentInk;
      case 'danger':
        return colors.errorInk;
      case 'outline':
      case 'ghost':
      case 'secondary':
      default:
        return colors.fg;
    }
  })();

  // Material ripple: light-on-dark for solid fills, ink-on-light elsewhere.
  const rippleColor =
    variant === 'primary' || variant === 'danger'
      ? 'rgba(255,255,255,0.18)'
      : colors.border;

  // Matches the Settings screen's own button recipe (app/modal.tsx's
  // "Save Key" / theme-picker buttons): rounded-xl, tight padding, no
  // shadow, plain opacity press — not a tall shadowed pill.
  const sizeClasses = {
    lg: 'px-5 py-3.5 rounded-xl min-h-[48px]',
    md: 'px-4 py-3 rounded-xl min-h-[42px]',
    sm: 'px-3 py-2 rounded-xl min-h-[36px]',
  }[size];

  const textSizeClasses = {
    lg: 'text-base',
    md: 'text-sm',
    sm: 'text-xs',
  }[size];

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: rippleColor }}
      className={`
        flex-row items-center justify-center overflow-hidden
        ${sizeClasses}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? '' : 'active:opacity-80'}
        ${className}
      `}
      style={{
        backgroundColor,
        opacity: disabled ? 0.55 : 1,
        borderWidth: variant === 'outline' ? 1 : 0,
        borderColor: variant === 'outline' ? `${colors.border}99` : undefined,
      }}
    >
      {icon && <View className="mr-2">{icon}</View>}
      <Text className={`font-sans-semi ${textSizeClasses}`} style={{ color: textColor }}>
        {title}
      </Text>
    </Pressable>
  );
};
