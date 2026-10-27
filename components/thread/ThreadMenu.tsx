import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AnimatePresence, MotiView } from 'moti';
import * as Haptics from 'expo-haptics';

import { Icon, type IconName } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EXIT_QUICK, REDUCED, SPRING_NAV } from '@/utils/motion';

export interface ThreadMenuItem {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** Red, for the one that can't be taken back. */
  danger?: boolean;
}

/**
 * The thread's ⋯ menu: everything you do to a thread now and then (edit,
 * share, pause, archive, delete), kept off the screen so the thread
 * itself comes first. Drops from its button; a tap anywhere else closes it.
 */
export function ThreadMenu({
  open,
  onClose,
  items,
  top,
}: {
  open: boolean;
  onClose: () => void;
  items: ThreadMenuItem[];
  /** Where the menu's top edge sits, under the nav row. */
  top: number;
}) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();

  return (
    <AnimatePresence>
      {open ? (
        <View key="menu" style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close menu"
          />
          <MotiView
            from={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, translateY: -6 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, translateY: -4 }}
            transition={reduceMotion ? REDUCED : SPRING_NAV}
            exitTransition={reduceMotion ? REDUCED : EXIT_QUICK}
            accessibilityRole="menu"
            style={[
              styles.menu,
              {
                top,
                backgroundColor: colors.surfaceRaised,
                borderColor: colors.border,
                shadowColor: '#000',
                transformOrigin: 'top right',
              },
            ]}
          >
            {items.map((item, i) => (
              <Pressable
                key={item.label}
                onPress={() => {
                  Haptics.selectionAsync();
                  onClose();
                  item.onPress();
                }}
                accessibilityRole="menuitem"
                style={({ pressed }) => [
                  styles.item,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                  pressed && { backgroundColor: colors.surfaceHigh },
                ]}
              >
                <Icon name={item.icon} size={17} color={item.danger ? colors.error : colors.fgSecondary} stroke={2} />
                <Text
                  className="font-sans-medium text-body ml-3"
                  style={{ color: item.danger ? colors.error : colors.fg }}
                  numberOfLines={1}
                >
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </MotiView>
        </View>
      ) : null}
    </AnimatePresence>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: 'absolute',
    right: 16,
    minWidth: 232,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    minHeight: 50,
  },
});
