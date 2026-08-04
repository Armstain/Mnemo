import React from 'react';
import { Pressable, Text } from 'react-native';
import { AnimatePresence, MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { useUndoToast } from '@/hooks/use-undo-toast';
import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { SPRING_SHEET, motion } from '@/utils/motion';
import { NAV_BAR_HEIGHT } from '@/components/ui/FloatingTabBar';

/**
 * Mounted once at the app root. Floats just above the tab bar so it never
 * competes with it — same reason the tab bar itself floats free of the
 * bottom edge instead of touching it.
 */
export function UndoToastHost() {
  const { toast, dismiss } = useUndoToast();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  return (
    <AnimatePresence>
      {toast && (
        <MotiView
          key={toast.id}
          from={{ opacity: 0, translateY: 16 }}
          animate={{ opacity: 1, translateY: 0 }}
          exit={{ opacity: 0, translateY: 16 }}
          transition={motion(SPRING_SHEET, reduceMotion)}
          pointerEvents="box-none"
          className="absolute left-6 right-6 z-50 flex-row items-center justify-between rounded-2xl px-4 py-3.5"
          style={{
            bottom: Math.max(insets.bottom, 16) + NAV_BAR_HEIGHT + 12,
            backgroundColor: colors.surfaceHigh,
            borderWidth: 1,
            borderColor: colors.border,
            shadowColor: '#000000',
            shadowOffset: { width: 0, height: 6 },
            shadowRadius: 16,
            shadowOpacity: 0.18,
            elevation: 12,
          }}
        >
          <Text
            className="font-sans-medium text-sm text-fg flex-1 mr-3"
            numberOfLines={1}
          >
            {toast.message}
          </Text>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              toast.onUndo();
              dismiss();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Undo"
          >
            <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
              Undo
            </Text>
          </Pressable>
        </MotiView>
      )}
    </AnimatePresence>
  );
}
