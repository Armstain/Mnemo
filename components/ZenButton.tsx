import React from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';

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
        return 'bg-surface-warm';
      case 'outline':
        return 'bg-transparent border border-border';
      case 'ghost':
        return 'bg-transparent';
      case 'danger':
        return 'bg-error';
      default:
        return 'bg-accent';
    }
  };

  const getTextColor = () => {
    switch (variant) {
      case 'primary':
        return 'text-white';
      case 'danger':
        return 'text-white';
      case 'outline':
      case 'ghost':
        return 'text-fg';
      case 'secondary':
        return 'text-fg';
      default:
        return 'text-white';
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

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      className={`
        flex-row items-center justify-center
        flex-row items-center justify-center
        rounded-lg
        ${getVariantStyles()}
        ${getSizeStyles()}
        ${fullWidth ? 'w-full' : ''}
        ${disabled ? 'opacity-40' : 'active:opacity-90 active:scale-[0.97]'}
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
