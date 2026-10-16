import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';

import { Icon, type IconName } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import { getActiveApiKey } from '@/lib/api-key';
import { setPreferences, usePreferences, type AiMode } from '@/lib/preferences';

const MODES: { value: Exclude<AiMode, 'unset'>; icon: IconName; title: string; body: string }[] = [
  {
    value: 'gemini',
    icon: 'sparkles',
    title: 'Smart, with Gemini',
    body: 'Your notes are tidied up, numbers and next steps found, and each note filed into the right thread. Each new note (and any photo on it) goes to Google with your key, along with the titles of your recent threads so it can be filed.',
  },
  {
    value: 'offline',
    icon: 'pin',
    title: 'Offline',
    body: 'Your notes never leave your phone. Titles, lists, amounts, next steps and dates are still picked out on the phone, and it suggests a thread when a note shares its words. (A link you save is opened by the phone to show its title.)',
  },
];

/** Settings → How Mnemo thinks: AI or offline. */
export function AiModeCard({ children }: { children?: React.ReactNode }) {
  const colors = useThemeColors();
  const { aiMode } = usePreferences();
  const mode = aiMode === 'unset' ? (getActiveApiKey() ? 'gemini' : 'offline') : aiMode;

  return (
    <View className="gap-3">
      <View className="bg-surface rounded-lg p-2 border border-border/50 gap-1">
        {MODES.map((m) => {
          const selected = mode === m.value;
          return (
            <Pressable
              key={m.value}
              onPress={() => {
                if (selected) return;
                Haptics.selectionAsync();
                setPreferences({ aiMode: m.value });
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              className="flex-row items-start rounded-md p-3.5 active:opacity-80"
              style={{
                backgroundColor: selected ? colors.surfaceRaised : 'transparent',
                borderWidth: selected ? 1 : 0,
                borderColor: colors.border,
              }}
            >
              <View
                className="w-5 h-5 rounded-full items-center justify-center mt-0.5"
                style={{ borderWidth: 2, borderColor: selected ? colors.accent : colors.outline }}
              >
                {selected ? <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colors.accent }} /> : null}
              </View>
              <View className="flex-1 ml-3">
                <View className="flex-row items-center">
                  <Icon name={m.icon} size={15} color={selected ? colors.accent : colors.fgTertiary} stroke={2} />
                  <Text className="font-sans-semi text-body ml-1.5" style={{ color: colors.fg }}>
                    {m.title}
                  </Text>
                </View>
                <Text className="font-sans text-sm mt-1 leading-relaxed" style={{ color: colors.fgSecondary }}>
                  {m.body}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {mode === 'gemini' ? children : null}

      <View className="bg-surface rounded-lg p-5 border border-border/50">
        <View className="flex-row items-center mb-1">
          <Icon name="mic" size={15} color={colors.accent} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Voice notes</Text>
        </View>
        <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
          Speak in Bangla, English or a mix. Your phone's speech service shows the words as you talk
          (on many phones that's Google's, which may work online). With Gemini on, Gemini writes the
          recording out properly, then it's deleted. Mnemo never keeps the audio.
        </Text>
      </View>
    </View>
  );
}
