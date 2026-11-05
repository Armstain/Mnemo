import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/utils/motion';
import { useState } from 'react';
import { View, ScrollView, Pressable, Platform, Switch } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { clearErrors, problemReport } from '@/lib/errors';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { Moon, Smartphone, Sun } from 'lucide-react-native';
import Constants from 'expo-constants';
import { haptic } from '@/utils/haptics';
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

function LinkRow({ icon, title, onPress, silent = false, chevron = true }: { icon: IconName; title: string; onPress: () => void; silent?: boolean; chevron?: boolean }) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        if (!silent) haptic.select();
        onPress();
      }}
      accessibilityRole="button"
      className="bg-surface rounded-lg px-5 py-4 border border-border/50 flex-row items-center active:opacity-80"
    >
      <Icon name={icon} size={15} color={colors.accent} />
      <Text className="font-sans-semi text-sm text-fg ml-2 flex-1">{title}</Text>
      {chevron ? <Icon name="chevronRight" size={16} color={colors.fgTertiary} /> : null}
    </Pressable>
  );
}

function HapticsRow() {
  const colors = useThemeColors();
  const { haptics } = usePreferences();
  return (
    <View className="bg-surface rounded-lg px-5 py-3 border border-border/50 flex-row items-center">
      <Text className="font-sans-semi text-sm text-fg flex-1">Vibration feedback</Text>
      <Switch
        value={haptics !== false}
        onValueChange={(on) => {
          if (!on) haptic.toggle(false);
          setPreferences({ haptics: on });
          if (on) haptic.toggle(true);
        }}
        accessibilityLabel="Vibration feedback"
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
        ios_backgroundColor={colors.border}
      />
    </View>
  );
}

export default function ModalScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();
  const [reportCopied, setReportCopied] = useState(false);
  const [logCleared, setLogCleared] = useState(false);

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
            <HapticsRow />
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

          <MotiView {...enter.rise(2)} className="gap-3 mb-10">
            <Eyebrow className="mb-1">Something not working?</Eyebrow>
            <LinkRow
              icon="copy"
              title={reportCopied ? 'Problem report copied' : 'Copy problem report'}
              silent
              chevron={false}
              onPress={async () => {
                await Clipboard.setStringAsync(await problemReport());
                haptic.success();
                setReportCopied(true);
                setLogCleared(false);
              }}
            />
            <LinkRow
              icon="trash"
              title={logCleared ? 'Error log cleared' : 'Clear error log'}
              silent
              chevron={false}
              onPress={async () => {
                await clearErrors();
                haptic.success();
                setLogCleared(true);
                setReportCopied(false);
              }}
            />
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
