import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { ActionCluster } from '@/components/ui/ActionCluster';
import { Tabs } from 'expo-router';
import { usePathname } from 'expo-router';
import React from 'react';
import { View } from 'react-native';

import { useThemeColors } from '@/hooks/use-theme';

export default function TabLayout() {
  const pathname = usePathname();
  const colors = useThemeColors();
  // Hide the FAB on the detail screen — it overlaps the status action row.
  const showFab = !pathname.includes('context');

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          // Every screen sits on the one solid bg tone — no glass/glow wash.
          sceneStyle: { backgroundColor: 'transparent' },
          // Tabs are peers, not a hierarchy — a slide implies a depth that
          // isn't there, and the user pays for it dozens of times a session.
          // The spatial cue this used to carry still exists, and it's the
          // one the eye actually tracks: the pill in FloatingTabBar travels
          // to the tapped tab on SPRING_NAV. The screen underneath doesn't
          // need to move as well for the change to read.
          animation: 'none',
        }}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="library" options={{ title: 'Library' }} />
        <Tabs.Screen name="context" options={{ title: 'Detail', href: null }} />
      </Tabs>

      <FloatingTabBar />
      <ActionCluster visible={showFab} />
    </View>
  );
}
