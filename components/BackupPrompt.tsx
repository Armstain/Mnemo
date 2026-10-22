import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { autoBackupAvailable, autoBackupOn, dismissBackupNudge, lastBackupAt, useBackupState } from '@/lib/auto-backup';
import { backupNudge } from '@/lib/backup';
import { useEnter } from '@/utils/motion';

const TEXT = {
  failing: { title: 'Backups have stopped', body: "Your notes haven't been backed up for a few days." },
  'turn-on': { title: 'Back up your notes', body: 'They only live on this phone. Turn on a daily backup.' },
  export: { title: 'Back up your notes', body: 'They only live on this phone. Save a backup file.' },
} as const;

/**
 * Home, when notes are at risk (lib/backup.ts, backupNudge): no backup for a
 * couple of weeks, or automatic backups failing. Opens Settings.
 */
export function BackupPrompt() {
  const colors = useThemeColors();
  const enter = useEnter();
  const { items, isLoaded } = useMnemoStore();
  const backup = useBackupState();
  if (Platform.OS === 'web' || !isLoaded) return null;

  const nudge = backupNudge({
    threads: items.length,
    autoOn: autoBackupOn(backup),
    autoAvailable: autoBackupAvailable,
    lastBackupAt: lastBackupAt(backup),
    failingSince: backup.failingSince,
    dismissedAt: backup.nudgeDismissedAt,
  });
  if (!nudge) return null;
  const text = TEXT[nudge];
  const body = nudge === 'failing' && backup.lastError ? backup.lastError : text.body;

  return (
    <MotiView {...enter.fade(1)} className="flex-row items-center rounded-lg mt-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Pressable
        onPress={() => router.push('/modal' as any)}
        accessibilityRole="button"
        accessibilityLabel={`${text.title}. ${body} Open settings.`}
        className="flex-1 flex-row items-center pl-4 py-3 active:opacity-80"
      >
        <View className="w-8 h-8 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.accentSoft }}>
          <Icon name="archive" size={16} color={nudge === 'failing' ? colors.error : colors.accent} stroke={2} />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
            {text.title}
          </Text>
          <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
            {body}
          </Text>
        </View>
      </Pressable>
      {/* Failing backups can't be waved away: the person believes they're covered. */}
      {nudge !== 'failing' ? (
        <Pressable
          onPress={dismissBackupNudge}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          className="w-11 h-11 items-center justify-center mr-1 active:opacity-60"
        >
          <Icon name="x" size={16} color={colors.fgTertiary} />
        </Pressable>
      ) : (
        <View className="w-3" />
      )}
    </MotiView>
  );
}
