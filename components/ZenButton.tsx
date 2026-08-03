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

  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return 'bg-accent';
      case 'secondary':
        return 'bg-surface-high';
      case 'outline':
        return 'bg-transparent border border-outline';
      case 'ghost':
        return 'bg-transparent';
      case 'danger':
        return 'bg-error';
      default:
        return 'bg-accent';
    }
  };

  // Material ripple: light-on-dark for solid fills, ink-on-light elsewhere.
  const rippleColor =
    variant === 'primary' || variant === 'danger'
      ? 'rgba(255,255,255,0.18)'
      : colors.border;

  const getTextColor = () => {
    switch (variant) {
      // Ink tokens pair with the fill per theme (dark ink on the bright
      // dark-theme fills, white on the deep light-theme fills).
      case 'primary':
        return 'text-accent-ink';
      case 'danger':
        return 'text-error-ink';
      case 'outline':
      case 'ghost':
        return 'text-fg';
      case 'secondary':
        return 'text-fg';
      default:
        return 'text-accent-ink';
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'lg':
        return 'px-8 py-5 min-h-[64px]';
      case 'sm':
        return 'px-4 py-2.5 min-h-[40px]';
      case 'md':
      default:
        return 'px-6 py-4 min-h-[52px]';
    }
  };

  const getTextSize = () => {
    switch (size) {
      case 'lg':
        return 'text-lg';
      case 'sm':
        return 'text-sm';
      default:
        return 'text-base';
    }
  };

  const getShadowStyle = () => {
    if (disabled || variant === 'ghost' || variant === 'outline') return '';
    return 'shadow-sm shadow-black/20 elevation-2';
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      android_ripple={disabled ? undefined : { color: rippleColor }}
      className={`
        flex-row items-center justify-center overflow-hidden
        rounded-full
        ${getVariantStyles()}
        ${getSizeStyles()}
        ${getShadowStyle()}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-55' : 'active:opacity-90'}
        ${className}
      `}
    >
      {icon && <View className="mr-3">{icon}</View>}
      <Text
        className={`font-sans-semi ${getTextColor()} ${getTextSize()}`}
      >
        {title}
      </Text>
    </Pressable>
  );
};
