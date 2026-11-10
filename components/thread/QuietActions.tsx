import React from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '@/components/ui/Button';
import { useQuietActions } from '@/hooks/use-thread-actions';
import { haptic } from '@/lib/haptics';
import { wrapupHref } from '@/lib/routes';
import type { MnemoItem } from '@/types/mnemo';

export function QuietActions({ item, from, className = 'mt-3' }: { item: MnemoItem; from?: 'review'; className?: string }) {
  const { stillOnIt, pause } = useQuietActions();
  return (
    <View className={`flex-row flex-wrap gap-2 ${className}`}>
      <Button variant="tonal" size="sm" icon="check" onPress={() => router.push(wrapupHref(item.id, from))}>
        Wrap up
      </Button>
      <Button
        variant="quiet"
        size="sm"
        onPress={() => {
          haptic.select();
          stillOnIt(item);
        }}
      >
        Still on it
      </Button>
      <Button
        variant="ghost"
        size="sm"
        icon="pause"
        onPress={() => {
          haptic.select();
          pause(item);
        }}
      >
        Pause
      </Button>
    </View>
  );
}
