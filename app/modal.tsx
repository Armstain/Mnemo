import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/utils/motion';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Platform } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MotiView } from 'moti';
import { Info, Moon, Shield, Smartphone, Sun } from 'lucide-react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { AutoBackupCard, BackupCard } from '@/components/settings/BackupCard';
import { AiModeCard } from '@/components/settings/AiModeCard';
import { confirmAction } from '@/utils/confirm';
import { problemReport } from '@/lib/errors';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '@/components/ui/Icon';
import { useThemeColors, useThemeName, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { ONBOARDING_KEY } from '@/app/onboarding';
import { NudgeSettingsCard } from '@/components/settings/NudgeSettingsCard';
import { ApiKeyConfigCard, GROQ } from '@/components/settings/ApiKeyConfigCard';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];


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

export default function ModalScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();
  const { clearAllData } = useMnemoStore();
  const [isClearing, setIsClearing] = useState(false);
  const [reportCopied, setReportCopied] = useState(false);

  // No undo here, unlike a single-item delete — wiping every note and
  // recording at once needs a real confirmation, not a grace window.
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
          // Reset onboarding too — a full data wipe should read as a
          // fresh install, not just an empty library.
          if (Platform.OS === 'web') {
            localStorage.removeItem(ONBOARDING_KEY);
          } else {
            await SecureStore.deleteItemAsync(ONBOARDING_KEY);
          }
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
      <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: insets.top + 32,
            paddingBottom: Math.max(insets.bottom, 24) + 48,
          }}
          showsVerticalScrollIndicator={false}
        >
          <MotiView {...enter.rise(0)}
            className="mb-10"
          >
            <Text className="text-display font-display text-fg mb-1">Settings</Text>
            <Text className="font-sans text-sm text-fg-tertiary">
              Mnemo v{Constants.expoConfig?.version ?? '1.0.0'}
            </Text>
          </MotiView>

          {/* Appearance */}
          <MotiView {...enter.rise(0)}
            className="gap-3 mb-10"
          >
            <Eyebrow className="mb-1">Appearance</Eyebrow>

            <View className="bg-surface rounded-lg p-2 border border-border/50 flex-row gap-1">
              {THEME_OPTIONS.map(({ key, label, icon: Icon }) => {
                const selected = preference === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setPreference(key)}
                    accessibilityLabel={`Use ${label.toLowerCase()} theme`}
                    className="flex-1 flex-row items-center justify-center py-2.5 rounded-md active:opacity-70"
                    style={{
                      backgroundColor: selected ? colors.surfaceWarm : 'transparent',
                      borderWidth: selected ? 1 : 0,
                      borderColor: selected ? `${colors.border}99` : 'transparent',
                    }}
                  >
                    <Icon
                      size={14}
                      color={selected ? colors.accent : colors.fgTertiary}
                      strokeWidth={2}
                    />
                    <Text
                      className="font-sans-medium text-sm ml-1.5"
                      style={{ color: selected ? colors.fg : colors.fgTertiary }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </MotiView>

          {/* Nudges — local notifications, so there's nothing to show on web. */}
          {Platform.OS !== 'web' && (
            <MotiView {...enter.rise(1)}
              className="gap-3 mb-10"
            >
              <Eyebrow className="mb-1">Nudges</Eyebrow>

              <NudgeSettingsCard />
            </MotiView>
          )}

          {/* AI */}
          <MotiView {...enter.rise(1)}
            className="gap-3 mb-10"
          >
            <Eyebrow className="mb-1">How Mnemo thinks</Eyebrow>

            <AiModeCard>
              <ApiKeyConfigCard />
              <ApiKeyConfigCard provider={GROQ} />
            </AiModeCard>
          </MotiView>

          {/* Backup */}
          <MotiView {...enter.rise(2)} className="gap-3 mb-10">
            <Eyebrow className="mb-1">Backup</Eyebrow>
            <AutoBackupCard />
            <BackupCard />
          </MotiView>

          {/* Privacy */}
          <MotiView {...enter.rise(2)}
            className="gap-3 mb-10"
          >
            <Eyebrow className="mb-1">Privacy</Eyebrow>

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

          {/* Problems */}
          <MotiView {...enter.rise(2)} className="gap-3 mb-10">
            <Eyebrow className="mb-1">Something not working?</Eyebrow>
            <Pressable
              onPress={async () => {
                await Clipboard.setStringAsync(await problemReport());
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setReportCopied(true);
              }}
              accessibilityRole="button"
              className="bg-surface rounded-lg p-5 border border-border/50 flex-row items-center active:opacity-80"
            >
              <Icon name="copy" size={15} color={colors.accent} />
              <View className="ml-2 flex-1">
                <Text className="font-sans-semi text-sm text-fg">
                  {reportCopied ? 'Problem report copied' : 'Copy problem report'}
                </Text>
                <Text className="font-sans text-sm text-fg-tertiary mt-0.5">
                  The app version and its recent error messages, to paste into a message. No notes.
                </Text>
              </View>
            </Pressable>
          </MotiView>

          {/* About */}
          <MotiView {...enter.rise(2)}
            className="gap-3"
          >
            <Eyebrow className="mb-1">About</Eyebrow>

            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                // Nothing is cleared: onboarding only rewrites the choices it asks about.
                router.dismissAll();
                router.replace('/onboarding');
              }}
              accessibilityRole="button"
              className="bg-surface rounded-lg p-5 border border-border/50 flex-row items-center active:opacity-80"
            >
              <Icon name="repeat" size={15} color={colors.accent} />
              <View className="ml-2 flex-1">
                <Text className="font-sans-semi text-sm text-fg">Go through setup again</Text>
                <Text className="font-sans text-sm text-fg-tertiary mt-0.5">
                  Your name, AI or offline, and nudges. Your notes stay as they are.
                </Text>
              </View>
            </Pressable>

            <View className="bg-surface rounded-lg p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Info size={15} color={colors.accent} />
                <Text className="font-sans-semi text-sm text-fg ml-2">Mnemo</Text>
              </View>
              <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
                Named after Mnemosyne, the Greek goddess of memory. Mnemo helps you leave a mental
                breadcrumb before stepping away from deep work, so you can pick up exactly where you
                left off.
              </Text>
            </View>
          </MotiView>
        </ScrollView>

      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
    </View>
  );
}
