import { FloatingTabBar } from '@/components/ui/FloatingTabBar';
import { ActionCluster } from '@/components/ui/ActionCluster';
import { Tabs } from 'expo-router';
import * as QuickActions from 'expo-quick-actions';
import { useQuickActionRouting, type RouterAction } from 'expo-quick-actions/router';
import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';

import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';

// Long-press-the-app-icon shortcuts. iOS draws SF Symbols; Android loads
// the vector drawables of the same names that plugins/with-shortcut-icons.js
// writes into res/drawable at prebuild.
const SHORTCUT_ICONS = {
  record: Platform.OS === 'ios' ? 'symbol:mic.fill' : 'shortcut_mic',
  note: Platform.OS === 'ios' ? 'symbol:square.and.pencil' : 'shortcut_note',
  resume: Platform.OS === 'ios' ? 'symbol:play.fill' : 'shortcut_resume',
};

/** Keeps the home-screen quick actions current, and routes them when tapped. */
function useCaptureShortcuts() {
  // Must live in a sub-layout, not the root layout — it navigates on
  // launch, which the root can't do before its navigator mounts.
  useQuickActionRouting();

  const { getActiveItems, isLoaded } = useMnemoStore();
  const latest = isLoaded ? getActiveItems()[0] : undefined;

  useEffect(() => {
    if (!isLoaded) return;
    const actions: RouterAction[] = [
      {
        id: 'record',
        title: 'Record a thought',
        icon: SHORTCUT_ICONS.record,
        params: { href: '/dump?autostart=1' },
      },
      {
        id: 'note',
        title: 'Write a note',
        icon: SHORTCUT_ICONS.note,
        params: { href: '/capture' },
      },
    ];
    if (latest) {
      actions.push({
        id: 'resume',
        // Android shows no subtitle, so its title has to carry the meaning.
        title: Platform.OS === 'ios' ? 'Resume' : 'Resume last thread',
        subtitle: latest.title,
        icon: SHORTCUT_ICONS.resume,
        params: { href: `/(tabs)/context?id=${latest.id}` },
      });
    }
    QuickActions.setItems(actions).catch(() => {
      // Unsupported launcher — the shortcuts are a convenience, never required.
    });
  }, [isLoaded, latest?.id, latest?.title]); // eslint-disable-line react-hooks/exhaustive-deps
}

export default function TabLayout() {
  const colors = useThemeColors();

  useCaptureShortcuts();

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
        <Tabs.Screen name="library" options={{ title: 'Library' }} />
        <Tabs.Screen name="context" options={{ title: 'Detail', href: null }} />
      </Tabs>

      <FloatingTabBar />
      {/* The capture button sits in the middle of the tab bar on every tab. */}
      <ActionCluster />
    </View>
  );
}
