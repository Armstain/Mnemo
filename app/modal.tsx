import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/utils/motion';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { Moon, Smartphone, Sun } from 'lucide-react-native';
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { AutoBackupCard, BackupCard } from '@/components/settings/BackupCard';
import { AiModeCard } from '@/components/settings/AiModeCard';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useThemeColors, useThemeName, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { NudgeSettingsCard } from '@/components/settings/NudgeSettingsCard';
import { LocationCard } from '@/components/settings/LocationCard';
import { ApiKeyConfigCard, GROQ } from '@/components/settings/ApiKeyConfigCard';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

function LinkRow({ icon, title, onPress }: { icon: IconName; title: string; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        Haptics.selectionAsync();
        onPress();
      }}
      accessibilityRole="button"
      className="bg-surface rounded-lg px-5 py-4 border border-border/50 flex-row items-center active:opacity-80"
    >
      <Icon name={icon} size={15} color={colors.accent} />
      <Text className="font-sans-semi text-sm text-fg ml-2 flex-1">{title}</Text>
      <Icon name="chevronRight" size={16} color={colors.fgTertiary} />
    </Pressable>
  );
}

export default function ModalScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();

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

          {/* Location: optional place reminders, off until turned on. */}
          <MotiView {...enter.rise(1)} className="gap-3 mb-10">
            <Eyebrow className="mb-1">Location</Eyebrow>
            <LocationCard />
          </MotiView>

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

          {/* Everything that explains rather than sets: one row each, on its own page. */}
          <MotiView {...enter.rise(2)} className="gap-3">
            <Eyebrow className="mb-1">Help</Eyebrow>
            <LinkRow icon="sparkles" title="How Mnemo works" onPress={() => router.push('/help')} />
            {Platform.OS !== 'web' ? (
              <LinkRow icon="alert" title="Check that reminders arrive" onPress={() => router.push('/reminders-check')} />
            ) : null}
            <LinkRow icon="pin" title="Privacy and your data" onPress={() => router.push('/privacy')} />
            <LinkRow
              icon="repeat"
              title="Go through setup again"
              onPress={() => {
                // Nothing is cleared: onboarding only rewrites the choices it asks about.
                router.dismissAll();
                router.replace('/onboarding');
              }}
            />
          </MotiView>
        </ScrollView>

      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
    </View>
  );
}
