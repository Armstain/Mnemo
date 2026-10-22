import React from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';

import { HomeBanner } from '@/components/ui/HomeBanner';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { autoBackupAvailable, autoBackupOn, dismissBackupNudge, lastBackupAt, useBackupState } from '@/lib/auto-backup';
import { backupNudge } from '@/lib/backup';

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
    <HomeBanner
      icon="archive"
      iconColor={nudge === 'failing' ? colors.error : undefined}
      title={text.title}
      body={body}
      onPress={() => router.push('/modal')}
      accessibilityLabel={`${text.title}. ${body} Open settings.`}
      // Failing backups can't be waved away: the person believes they're covered.
      onDismiss={nudge === 'failing' ? undefined : dismissBackupNudge}
    />
  );
}
