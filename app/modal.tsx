import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/hooks/use-enter';
import { View, ScrollView, Pressable, Platform, Linking } from 'react-native';
import { IconButton } from '@/components/ui/Button';
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
import { AppointmentsCard } from '@/components/settings/AppointmentsCard';
import { LocationCard } from '@/components/settings/LocationCard';
import { ApiKeyConfigCard, GROQ } from '@/components/settings/ApiKeyConfigCard';

const REPO = 'https://github.com/Armstain/Mnemo';

function openIssue(label: string, title: string) {
  const version = Constants.expoConfig?.version ?? '';
  const body = `Mnemo v${version} on ${Platform.OS} ${Platform.Version}\n\n`;
  Linking.openURL(`${REPO}/issues/new?labels=${label}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`);
}

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

const ROW = 'px-5 py-3';

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
            paddingTop: insets.top + 16,
            paddingBottom: bottom + 48,
          }}
          showsVerticalScrollIndicator={false}
        >
          <MotiView {...enter.rise(0)} className="flex-row items-center mb-6 -ml-2">
            <IconButton icon="chevronLeft" label="Back" variant="bare" onPress={() => router.back()} />
            <Text className="text-display font-display text-fg ml-1">Settings</Text>
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

          {Platform.OS !== 'web' && (
            <SettingsSection title="Appointments" step={1}>
              <AppointmentsCard />
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

          <SettingsSection title="Help and feedback" step={2}>
            <LinkRow className={ROW} icon="sparkles" title="How Mnemo works" onPress={() => router.push(helpHref)} />
            {Platform.OS !== 'web' ? (
              <LinkRow className={ROW} icon="alert" title="Check that reminders arrive" onPress={() => router.push(remindersCheckHref)} />
            ) : null}
            <LinkRow className={ROW} icon="arrowUpRight" title="Report a bug" onPress={() => openIssue('bug', 'Bug: ')} />
            <LinkRow className={ROW} icon="star" title="Suggest a feature" onPress={() => openIssue('enhancement', 'Idea: ')} />
            <LinkRow className={ROW} icon="copy" title={report.reportTitle} silent chevron={false} onPress={report.copyReport} />
            <LinkRow className={ROW} icon="trash" title={report.clearTitle} silent chevron={false} onPress={report.clearLog} />
          </SettingsSection>

          <SettingsSection title="About" step={2} last>
            <Surface tone="soft" className="rounded-lg px-5 py-3">
              <Text className="font-sans-semi text-sm text-fg">Mnemo v{Constants.expoConfig?.version ?? '1.0.0'}</Text>
              <Text className="font-sans text-sm text-fg-tertiary mt-0.5">Resume your life.</Text>
            </Surface>
            <LinkRow className={ROW} icon="arrowUpRight" title="Source code" onPress={() => Linking.openURL(REPO)} />
            <LinkRow className={ROW} icon="pin" title="Privacy and your data" onPress={() => router.push(privacyHref)} />
            <LinkRow
              className={ROW}
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
