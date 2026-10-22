import { useEffect } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { router } from 'expo-router';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { setIncomingShare } from '@/lib/shared';

// Receiving from the share sheet needs native code Expo Go doesn't have;
// there the module isn't loaded at all (importing it would throw).
const shareModule: typeof import('expo-share-intent') | null =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ? null : require('expo-share-intent');

/** Opens the Save screen when something is shared to Mnemo. */
export function ShareIntake() {
  if (!shareModule) return null;
  return <Listener module={shareModule} />;
}

function Listener({ module }: { module: typeof import('expo-share-intent') }) {
  const { hasShareIntent, shareIntent, resetShareIntent } = module.useShareIntent({ resetOnBackground: true });
  const { isLoaded } = useMnemoStore();

  useEffect(() => {
    if (!hasShareIntent || !isLoaded) return;
    const photos = (shareIntent.files ?? [])
      .filter((f) => f.mimeType?.startsWith('image/'))
      .map((f) => ({ uri: f.path, mimeType: f.mimeType }));
    const text = shareIntent.text?.trim() || undefined;
    setIncomingShare({
      text,
      url: shareIntent.webUrl ?? undefined,
      title: shareIntent.meta?.title ?? undefined,
      photos,
    });
    resetShareIntent();
    router.push('/share');
  }, [hasShareIntent, isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
