import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  return (
    <AmbientGlow>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: { display: 'none' },
          // Scenes stay transparent so every screen shares the one
          // ambient field — glass surfaces need it showing through.
          sceneStyle: { backgroundColor: 'transparent' },
        }}>
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="search" options={{ title: 'Search' }} />
        <Tabs.Screen name="library" options={{ title: 'Library' }} />
        <Tabs.Screen name="context" options={{ title: 'Detail', href: null }} />
      </Tabs>

      <FloatingTabBar />
    </AmbientGlow>
  );
}
