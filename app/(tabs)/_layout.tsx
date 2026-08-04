import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { ActionCluster } from '@/components/ui/ActionCluster';
import { Tabs } from 'expo-router';
import { usePathname } from 'expo-router';
import React from 'react';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { SPRING_NAV } from '@/utils/motion';

export default function TabLayout() {
  const pathname = usePathname();
  const reduceMotion = useReduceMotion();
  // Hide the FAB on the detail screen — it overlaps the status action row.
  const showFab = !pathname.includes('context');

  return (
    <AmbientGlow>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          // Scenes stay transparent so every screen shares the one
          // ambient field — glass surfaces need it showing through.
          sceneStyle: { backgroundColor: 'transparent' },
          // 'shift' moves the incoming screen in from the side it lives on
          // relative to the current tab, so the direction of travel matches
          // the direction the pill indicator moves. Spatial consistency: the
          // user never has to re-find where they are after a tab change.
          // Reduced motion gets the same state change with no travel.
          animation: reduceMotion ? 'fade' : 'shift',
          transitionSpec: {
            animation: 'spring',
            config: {
              damping: SPRING_NAV.damping,
              stiffness: SPRING_NAV.stiffness,
              mass: SPRING_NAV.mass,
            },
          },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="library" options={{ title: 'Library' }} />
        <Tabs.Screen name="context" options={{ title: 'Detail', href: null }} />
      </Tabs>

      <FloatingTabBar />
      {showFab && <ActionCluster />}
    </AmbientGlow>
  );
}
