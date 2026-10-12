import React, { useEffect } from 'react';
import { Pressable, Text, useColorScheme, View } from 'react-native';
import type { ErrorBoundaryProps } from 'expo-router';

import { logError } from '@/lib/errors';

/**
 * Shown instead of a blank screen when something breaks while drawing.
 * Plain on purpose: the app's own providers may be what failed. Notes are
 * safe on the phone; "Try again" redraws.
 */
export function CrashScreen({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  const c = dark
    ? { bg: '#121310', fg: '#ECE9E0', muted: '#9A978C', accent: '#5DDBA0', ink: '#00301C' }
    : { bg: '#FAF8F3', fg: '#1C1A15', muted: '#6B665B', accent: '#0D6B4A', ink: '#FFFFFF' };

  useEffect(() => {
    logError('screen', error);
  }, [error]);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, justifyContent: 'center', padding: 32 }}>
      <Text style={{ color: c.fg, fontSize: 24, fontWeight: '600', marginBottom: 8 }}>Something went wrong</Text>
      <Text style={{ color: c.muted, fontSize: 15, lineHeight: 22, marginBottom: 24 }}>
        Your notes are safe on this phone. Try again; if it keeps happening, Settings → “Copy problem report”
        has the details to send.
      </Text>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        style={{ backgroundColor: c.accent, borderRadius: 999, paddingVertical: 14, alignItems: 'center' }}
      >
        <Text style={{ color: c.ink, fontSize: 16, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}
