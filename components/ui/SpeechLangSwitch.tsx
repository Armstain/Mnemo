import React from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { SPEECH_LANG_NAME } from '@/hooks/use-speech-capture';
import type { SpeechLang } from '@/lib/preferences';

const ORDER: SpeechLang[] = ['bn-BD', 'en-US'];

/**
 * Which language the phone listens in: বাংলা or English. One language per
 * note keeps Android from guessing (it heard Bangla as Hindi); English words
 * mixed into Bangla still come through. Remembered for next time.
 */
export function SpeechLangSwitch({ value, onSwitch }: { value: SpeechLang; onSwitch: () => void }) {
  const colors = useThemeColors();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Language you're speaking"
      className="flex-row self-center rounded-full p-1"
      style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
    >
      {ORDER.map((lang) => {
        const on = lang === value;
        return (
          <Pressable
            key={lang}
            accessibilityRole="radio"
            aria-checked={on}
            accessibilityLabel={lang === 'bn-BD' ? 'Bangla' : 'English'}
            hitSlop={{ top: 8, bottom: 8 }}
            onPress={() => {
              if (on) return;
              Haptics.selectionAsync();
              onSwitch();
            }}
            className="rounded-full px-4 h-9 items-center justify-center"
            style={{ backgroundColor: on ? colors.fg : 'transparent' }}
          >
            <Text className="font-sans-semi text-sm" style={{ color: on ? colors.bg : colors.fgSecondary }}>
              {SPEECH_LANG_NAME[lang]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
