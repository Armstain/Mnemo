import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { autoBackupAvailable, runAutoBackup } from '@/lib/auto-backup';

// Sealing a backup takes a second or two of work; not while the app is
// still drawing its first screens.
const AFTER_LAUNCH_MS = 20 * 1000;

/**
 * Invisible component mounted at the app root, next to NudgeScheduler.
 * Writes the daily automatic backup (lib/auto-backup.ts) when one is due:
 * a while after launch, and whenever the app goes to the background, which
 * is right after the person changed something and can't feel the work.
 */
export function AutoBackup() {
  // exportBackup reads the store's latest notes through refs, so it never changes.
  const { exportBackup, isLoaded } = useMnemoStore();

  useEffect(() => {
    if (!autoBackupAvailable || !isLoaded) return;
    const run = () => void runAutoBackup(exportBackup());
    const handle = setTimeout(run, AFTER_LAUNCH_MS);
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'background') run();
    });
    return () => {
      clearTimeout(handle);
      subscription.remove();
    };
  }, [isLoaded, exportBackup]);

  return null;
}
