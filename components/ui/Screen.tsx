import React from 'react';
import { KeyboardAvoidingView, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import type { IconName } from '@/components/ui/Icon';

/** Top padding for a full-screen page: the status bar's height, but never less than 16. */
export function useSafeTop(): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.top, 16);
}

/** Bottom padding for a full-screen page: the home indicator's height, but never less than `min`. */
export function useSafeBottom(min = 24): number {
  const insets = useSafeAreaInsets();
  return Math.max(insets.bottom, min);
}

export function KeyboardAvoid({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView className={className} style={style} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}

/**
 * The row at the top of a modal page: a close (or back) button on the left, an
 * optional centred title, and whatever belongs on the right.
 */
export function ScreenHeader({
  onClose,
  title,
  trailing,
  icon = 'x',
  label = 'Close',
  className = 'px-6 mb-3',
}: {
  onClose: () => void;
  title?: string;
  trailing?: React.ReactNode;
  icon?: IconName;
  label?: string;
  className?: string;
}) {
  return (
    <View className={`flex-row items-center justify-between ${className}`}>
      <IconButton icon={icon} label={label} variant="bare" onPress={onClose} />
      {title ? (
        <Text className="flex-1 text-center font-sans-medium text-sm text-fg-secondary mx-3" numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {trailing}
    </View>
  );
}
