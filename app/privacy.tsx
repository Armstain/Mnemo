import { StatusBar } from 'expo-status-bar';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';
import { MotiView } from 'moti';
import { Shield } from 'lucide-react-native';
import { useState } from 'react';

import { Text } from '@/components/ui/Text';
import { Icon } from '@/components/ui/Icon';
import { IconButton } from '@/components/ui/Button';
import { confirmAction } from '@/utils/confirm';
import { useEnter } from '@/utils/motion';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { ONBOARDING_KEY } from '@/app/onboarding';

// What leaves the phone, and when: said plainly, every case.
const PRIVACY_FACTS = [
  {
    title: 'With Gemini on',
    body:
      'Sent to Google with your key: the text of each new note, the recording of a voice note, and any photo on it; the title and description of a page you saved a link to, as your phone read them, so the note can be understood; the titles and a line from your recently active threads, so it can file the note; your question and the notes that best match it, when you ask; note text for meaning search (notes written before you turned Gemini on only if you say so), and the notes of a thread when you ask to organise them. On a free key, Google may use what you send to improve its products, and people may review it. Offline, none of this happens.',
  },
  {
    title: 'Voice',
    body:
      "With Gemini on, a voice note is recorded and sent to Gemini to be written out (to Groq instead, if you added a Groq key and Gemini can't), then the recording is deleted from the phone. Offline, nothing is recorded: your phone's speech service turns what you say into text as you talk (on many phones that is Google's, which may process it online). Mnemo never keeps the audio.",
  },
  {
    title: 'Links',
    body: 'A link you save is opened by the phone, once, to show its title and picture. That page sees the request like any visit. With Gemini on, the title and description it gives are sent with your note; the page itself is not.',
  },
];

export default function PrivacyScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { clearAllData } = useMnemoStore();
  const [isClearing, setIsClearing] = useState(false);

  const handleClearAllData = () =>
    confirmAction({
      title: 'Clear all data',
      message:
        'This permanently deletes every thread, note, photo and reminder on this phone. Make a backup first if you might want them back. This cannot be undone.',
      confirmLabel: 'Delete everything',
      onConfirm: async () => {
        setIsClearing(true);
        try {
          await clearAllData();
          if (Platform.OS === 'web') {
            localStorage.removeItem(ONBOARDING_KEY);
          } else {
            await SecureStore.deleteItemAsync(ONBOARDING_KEY);
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.dismissAll();
          router.replace('/onboarding');
        } catch (e) {
          console.error('Failed to clear all data', e);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          Alert.alert('Something went wrong', 'Not everything could be deleted. Please try again.');
        } finally {
          setIsClearing(false);
        }
      },
    });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: Math.max(insets.bottom, 24) + 48,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="flex-row mb-4">
          <IconButton icon="chevronLeft" label="Back" variant="bare" onPress={() => router.back()} />
        </View>

        <MotiView {...enter.rise(0)} className="mb-8">
          <Text className="text-display font-display text-fg">Privacy</Text>
        </MotiView>

        <MotiView {...enter.rise(1)} className="gap-3 mb-10">
          <View className="bg-surface rounded-lg p-5 border border-border/50">
            <View className="flex-row items-center mb-2">
              <Shield size={15} color={colors.accent} />
              <Text className="font-sans-semi text-sm text-fg ml-2">Your data</Text>
            </View>
            <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
              Your notes, photos and reminders live only on this phone. Mnemo has no server and no
              account; a backup is a file you keep, locked with your passphrase.
            </Text>
          </View>

          {PRIVACY_FACTS.map((fact) => (
            <View key={fact.title} className="bg-surface rounded-lg p-5 border border-border/50">
              <Text className="font-sans-semi text-sm text-fg mb-1.5">{fact.title}</Text>
              <Text className="font-sans text-sm text-fg-secondary leading-relaxed">{fact.body}</Text>
            </View>
          ))}
        </MotiView>

        <MotiView {...enter.rise(2)}>
          <Pressable
            onPress={handleClearAllData}
            disabled={isClearing}
            accessibilityRole="button"
            accessibilityLabel="Clear all data"
            className={`bg-surface rounded-lg p-5 border border-error/30 flex-row items-center ${
              isClearing ? 'opacity-60' : 'active:opacity-80'
            }`}
          >
            <Icon name="trash" size={15} color={colors.error} />
            <View className="ml-2 flex-1">
              <Text className="font-sans-semi text-sm text-error">Clear all data</Text>
              <Text className="font-sans text-sm text-fg-tertiary mt-0.5">
                Permanently deletes every thread, note and photo on this phone
              </Text>
            </View>
            {isClearing && <ActivityIndicator size="small" color={colors.error} />}
          </Pressable>
        </MotiView>
      </ScrollView>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}
