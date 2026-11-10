import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/hooks/use-enter';
import { View, ScrollView, Pressable, Platform } from 'react-native';
import { useProblemReport } from '@/hooks/use-problem-report';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { Moon, Smartphone, Sun } from 'lucide-react-native';
import Constants from 'expo-constants';
import { haptic } from '@/lib/haptics';
import { Surface } from '@/components/ui/Card';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { LinkRow } from '@/components/settings/LinkRow';
import { useSafeBottom } from '@/components/ui/Screen';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { AutoBackupCard, BackupCard } from '@/components/settings/BackupCard';
import { AiModeCard } from '@/components/settings/AiModeCard';
import { helpHref, onboardingHref, privacyHref, remindersCheckHref } from '@/lib/routes';
import { useThemeColors, useThemeName, useThemePreference, type ThemePreference } from '@/hooks/use-theme';
import { NudgeSettingsCard } from '@/components/settings/NudgeSettingsCard';
import { LocationCard } from '@/components/settings/LocationCard';
import { ApiKeyConfigCard, GROQ } from '@/components/settings/ApiKeyConfigCard';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

function HapticsRow() {
  const { haptics } = usePreferences();
  return (
    <ToggleRow
      title="Vibration feedback"
      className="px-5 py-3"
      value={haptics !== false}
      onValueChange={(on) => {
        if (!on) haptic.toggle(false);
        setPreferences({ haptics: on });
        if (on) haptic.toggle(true);
      }}
    />
  );
}

export default function ModalScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const bottom = useSafeBottom();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();
  const report = useProblemReport();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: insets.top + 32,
            paddingBottom: bottom + 48,
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

          <SettingsSection title="Appearance" step={0}>
            <Surface tone="soft" className="rounded-lg p-2 flex-row gap-1">
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
                    <Icon size={14} color={selected ? colors.accent : colors.fgTertiary} strokeWidth={2} />
                    <Text
                      className="font-sans-medium text-sm ml-1.5"
                      style={{ color: selected ? colors.fg : colors.fgTertiary }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </Surface>
            <HapticsRow />
          </SettingsSection>

          {Platform.OS !== 'web' && (
            <SettingsSection title="Nudges" step={1}>
              <NudgeSettingsCard />
            </SettingsSection>
          )}

          <SettingsSection title="Location" step={1}>
            <LocationCard />
          </SettingsSection>

          <SettingsSection title="How Mnemo thinks" step={1}>
            <AiModeCard>
              <ApiKeyConfigCard />
              <ApiKeyConfigCard provider={GROQ} />
            </AiModeCard>
          </SettingsSection>

          <SettingsSection title="Backup" step={2}>
            <AutoBackupCard />
            <BackupCard />
          </SettingsSection>

          <SettingsSection title="Something not working?" step={2}>
            <LinkRow icon="copy" title={report.reportTitle} silent chevron={false} onPress={report.copyReport} />
            <LinkRow icon="trash" title={report.clearTitle} silent chevron={false} onPress={report.clearLog} />
          </SettingsSection>

          <SettingsSection title="Help" step={2} last>
            <LinkRow icon="sparkles" title="How Mnemo works" onPress={() => router.push(helpHref)} />
            {Platform.OS !== 'web' ? (
              <LinkRow icon="alert" title="Check that reminders arrive" onPress={() => router.push(remindersCheckHref)} />
            ) : null}
            <LinkRow icon="pin" title="Privacy and your data" onPress={() => router.push(privacyHref)} />
            <LinkRow
              icon="repeat"
              title="Go through setup again"
              onPress={() => {
                router.dismissAll();
                router.replace(onboardingHref);
              }}
            />
          </SettingsSection>
        </ScrollView>

      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
    </View>
  );
}
