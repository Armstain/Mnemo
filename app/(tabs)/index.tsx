import React from 'react';
import { View, Text } from 'react-native';
import { MotiView } from 'moti';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { PulseHome } from '@/components/ui/PulseHome';

export default function HomeScreen() {
  const { isLoaded } = useMnemoStore();

  if (!isLoaded) {
    return (
      <View className="flex-1 items-center justify-center">
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 800 }}
        >
          <Text className="font-sans-medium text-sm text-fg-tertiary tracking-wide">
            Loading your life...
          </Text>
        </MotiView>
      </View>
    );
  }

  return <PulseHome />;
}
