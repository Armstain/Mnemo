import { useEffect, useRef } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { resumeOrder } from '@/lib/when';
import { renderCaptureWidget, type WidgetSnapshot } from '@/widgets/CaptureWidget';
import { writeWidgetSnapshot } from '@/widgets/snapshot';

// Not in Expo Go (no native widget module there).
const widgetModule: typeof import('react-native-android-widget') | null =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : require('react-native-android-widget');

/** Keeps the home-screen widget showing the thread to pick up next. */
export function WidgetSync() {
  const { items, focusThreadId, isLoaded, getActiveItems } = useMnemoStore();
  const last = useRef('');

  useEffect(() => {
    if (!widgetModule || !isLoaded) return;
    const top = resumeOrder(getActiveItems(), { focusId: focusThreadId })[0];
    const snapshot: WidgetSnapshot = top ? { id: top.id, title: top.title, nextStep: top.nextStep } : {};
    const key = JSON.stringify(snapshot);
    if (key === last.current) return;
    last.current = key;
    writeWidgetSnapshot(snapshot);
    widgetModule
      .requestWidgetUpdate({ widgetName: 'Capture', renderWidget: () => renderCaptureWidget(snapshot) })
      .catch(() => {
        // No widget on the home screen, or the launcher said no.
      });
  }, [items, focusThreadId, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
