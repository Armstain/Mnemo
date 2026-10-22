import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/utils/motion';
import { View, ScrollView, Pressable, ActivityIndicator, Alert, Platform, Switch, Linking } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MotiView } from 'moti';
import {
  Bell,
  Info,
  Key,
  Moon,
  Shield,
  Smartphone,
  Sun,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { AutoBackupCard, BackupCard } from '@/components/settings/BackupCard';
import { AiModeCard } from '@/components/settings/AiModeCard';
import { noFocusRing } from '@/utils/web';
import { confirmAction } from '@/utils/confirm';
import { problemReport } from '@/lib/errors';
import * as Clipboard from 'expo-clipboard';
import { Icon } from '@/components/ui/Icon';
import {
  useThemeColors,
  useThemeName,
  useThemePreference,
  type ThemePreference,
} from '@/hooks/use-theme';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { ONBOARDING_KEY } from '@/app/onboarding';
import {
  NUDGE_TIMES,
  hasNudgePermission,
  loadNudgePrefs,
  requestNudgePermission,
  saveNudgePrefs,
  scheduleNudges,
  sendTestNudge,
  type NudgePrefs,
  type NudgeTime,
} from '@/lib/nudges';
import { reviewTimeLabel, scheduleWeeklyReview } from '@/lib/review-notice';
import { loadSetup, strictPhone } from '@/lib/reliability';
import {
  getActiveApiKey,
  getActiveGroqApiKey,
  saveApiKey,
  saveGroqApiKey,
  validateApiKey,
  validateGroqApiKey,
  loadStoredApiKeys,
} from '@/lib/api-key';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

const NUDGE_TIME_KEYS = Object.keys(NUDGE_TIMES) as NudgeTime[];

function NudgeSettingsCard() {
  const colors = useThemeColors();
  const { items, entries } = useMnemoStore();
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [granted, setGranted] = useState(false);
  // Set once a turn-on attempt comes back refused — at that point only
  // the OS Settings app can change it, so say so instead of silently
  // leaving the switch off.
  const [blocked, setBlocked] = useState(false);
  const [verified, setVerified] = useState(false);
  const strict = strictPhone();
  const [pickingTime, setPickingTime] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    loadNudgePrefs().then(setPrefs);
    hasNudgePermission().then(setGranted);
    loadSetup().then((s) => setVerified(!!s.verifiedAt));
  }, []);

  const apply = async (next: NudgePrefs) => {
    setPrefs(next);
    await saveNudgePrefs(next);
    scheduleNudges(items);
    scheduleWeeklyReview(items, entries);
  };

  const handleToggle = async (on: boolean) => {
    if (!prefs) return;
    if (!on) {
      await apply({ ...prefs, enabled: false });
      return;
    }
    const ok = await requestNudgePermission();
    setGranted(ok);
    setBlocked(!ok);
    if (ok) {
      Haptics.selectionAsync();
      await apply({ ...prefs, enabled: true });
    }
  };

  const handleTest = async () => {
    const ok = await sendTestNudge();
    setGranted(ok);
    setBlocked(!ok);
    setTestSent(ok);
  };

  const pickCustom = (date?: Date) => {
    if (!prefs || !date) return;
    apply({ ...prefs, time: 'custom', custom: { hour: date.getHours(), minute: date.getMinutes() } });
  };

  if (!prefs) return null;
  const isOn = prefs.enabled && granted;
  const customAt = prefs.custom ? new Date(0, 0, 1, prefs.custom.hour, prefs.custom.minute) : new Date(0, 0, 1, 9, 0);

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1 mr-3">
          <Bell size={15} color={colors.accent} strokeWidth={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Gentle nudges</Text>
        </View>
        <Switch
          value={isOn}
          onValueChange={handleToggle}
          accessibilityLabel="Gentle nudges"
          trackColor={{ false: colors.border, true: colors.accent }}
          thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
          ios_backgroundColor={colors.border}
        />
      </View>

      <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
        When a thread sits untouched for a couple of days, Mnemo reminds you of it once, with
        its next step. Never more than one a day.
      </Text>

      {isOn && (
        <View className="flex-row flex-wrap gap-2">
          {NUDGE_TIME_KEYS.map((key) => (
            <Pill
              key={key}
              tone={colors.accent}
              size="md"
              dot={false}
              outline={prefs.time !== key}
              selected={prefs.time === key}
              onPress={() => apply({ ...prefs, time: key })}
            >
              {NUDGE_TIMES[key].label}
            </Pill>
          ))}
          <Pill
            tone={colors.accent}
            size="md"
            dot={false}
            outline={prefs.time !== 'custom'}
            selected={prefs.time === 'custom'}
            onPress={() => setPickingTime(true)}
          >
            {prefs.custom
              ? `Custom · ${prefs.custom.hour}:${String(prefs.custom.minute).padStart(2, '0')}`
              : 'Custom…'}
          </Pill>
        </View>
      )}

      {pickingTime &&
        (Platform.OS === 'ios' ? (
          <View>
            <DateTimePicker value={customAt} mode="time" display="spinner" onChange={(_, d) => pickCustom(d)} />
            <Button size="sm" variant="quiet" fullWidth onPress={() => setPickingTime(false)}>
              Done
            </Button>
          </View>
        ) : (
          <DateTimePicker
            value={customAt}
            mode="time"
            onChange={(e, d) => {
              setPickingTime(false);
              if (e.type === 'set') pickCustom(d);
            }}
          />
        ))}

      {isOn && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-sm text-fg-tertiary flex-1">
            {testSent ? 'Sent. It shows up in about 5 seconds, even with the app closed.' : 'Check that nudges reach you.'}
          </Text>
          <Button variant="quiet" size="sm" onPress={handleTest}>
            Send a test
          </Button>
        </View>
      )}

      {isOn && (
        <View className="flex-row items-center justify-between pt-4 border-t border-border/50">
          <View className="flex-1 mr-3">
            <Text className="font-sans-semi text-sm text-fg">Weekly review</Text>
            <Text className="font-sans text-sm text-fg-secondary mt-0.5">
              {reviewTimeLabel()}: your week, what's due and what went quiet.
            </Text>
          </View>
          <Switch
            value={prefs.weekly}
            onValueChange={(weekly) => apply({ ...prefs, weekly })}
            accessibilityLabel="Weekly review"
            trackColor={{ false: colors.border, true: colors.accent }}
            thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
            ios_backgroundColor={colors.border}
          />
        </View>
      )}

      {blocked && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-sm text-fg-tertiary flex-1">
            Notifications are off for Mnemo in your phone's settings.
          </Text>
          <Button variant="quiet" size="sm" onPress={() => Linking.openSettings()}>
            Open settings
          </Button>
        </View>
      )}

      {/* Reminders and nudges both depend on it, so it's here whether nudges are on or not. */}
      <Pressable
        onPress={() => router.push('/reminders-check' as any)}
        accessibilityRole="button"
        className="flex-row items-center justify-between pt-4 border-t border-border/50 active:opacity-70"
      >
        <View className="flex-1 mr-3">
          <Text className="font-sans-semi text-sm text-fg">Make sure reminders arrive</Text>
          <Text className="font-sans text-sm text-fg-secondary mt-0.5">
            {verified
              ? 'Tested on this phone and working.'
              : strict
                ? `${strict} phones can hold reminders back. Check the settings and send a test.`
                : 'Check the settings and send a test reminder.'}
          </Text>
        </View>
        <Icon name="chevronRight" size={16} color={colors.fgTertiary} />
      </Pressable>
    </View>
  );
}

interface KeyProvider {
  name: string;
  placeholder: string;
  /** Under the title: what it's for. */
  note?: string;
  get: () => string;
  save: (key: string) => Promise<void>;
  validate: (key: string) => Promise<{ valid: boolean; error?: string }>;
  working: string;
  consoleUrl: string;
  consoleName: string;
}

const GEMINI: KeyProvider = {
  name: 'Gemini API key',
  placeholder: 'AIzaSy...',
  get: getActiveApiKey,
  save: saveApiKey,
  validate: validateApiKey,
  working: 'Connection successful! Gemini API is working.',
  consoleUrl: 'https://aistudio.google.com/app/apikey',
  consoleName: 'Google AI Studio',
};

const GROQ: KeyProvider = {
  name: 'Groq API key (optional)',
  placeholder: 'gsk_...',
  note: "A backup for voice notes: when Gemini can't write one out (down, or today's free limit is used up), Groq's Whisper does. The recording goes to Groq only then.",
  get: getActiveGroqApiKey,
  save: saveGroqApiKey,
  validate: validateGroqApiKey,
  working: 'Groq is working. It writes out voice notes when Gemini can’t.',
  consoleUrl: 'https://console.groq.com/keys',
  consoleName: 'console.groq.com',
};

function ApiKeyConfigCard({ provider = GEMINI }: { provider?: KeyProvider }) {
  const colors = useThemeColors();
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [source, setSource] = useState<'custom' | 'none'>('none');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      await loadStoredApiKeys();
      setInputKey(provider.get());
      setSource(provider.get() ? 'custom' : 'none');
    })();
  }, [provider]);

  const handleSave = async () => {
    setIsSaving(true);
    setTestResult(null);
    try {
      await provider.save(inputKey);
      const newSource = provider.get() ? 'custom' : 'none';
      setSource(newSource);
      if (inputKey.trim()) {
        setTestResult({ success: true, message: 'Key saved securely!' });
      } else {
        setTestResult({ success: true, message: 'Custom key cleared.' });
      }
    } catch {
      setTestResult({ success: false, message: 'Failed to save key.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await provider.validate(inputKey);
    setIsTesting(false);
    if (result.valid) {
      setTestResult({ success: true, message: provider.working });
    } else {
      setTestResult({ success: false, message: result.error || 'Validation failed.' });
    }
  };

  const handleClear = async () => {
    setInputKey('');
    await provider.save('');
    setSource('none');
    setInputKey(provider.get());
    setTestResult({ success: true, message: 'Custom key reset.' });
  };

  const openGoogleAIStudio = () => {
    WebBrowser.openBrowserAsync(provider.consoleUrl);
  };

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Key size={16} color={colors.accent} strokeWidth={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">{provider.name}</Text>
        </View>

        <Pill tone={source === 'none' ? (provider === GEMINI ? colors.error : colors.fgTertiary) : colors.accent} size="sm">
          {source === 'custom' ? 'Your key' : 'Not set'}
        </Pill>
      </View>
      {provider.note ? (
        <Text className="font-sans text-sm text-fg-secondary leading-relaxed -mt-1">{provider.note}</Text>
      ) : null}

      {/* Input Field */}
      <View className="gap-1.5">
        <View className="flex-row items-center bg-surface-warm rounded-md border border-border/60 px-3.5 py-2">
          <TextInput
            value={inputKey}
            onChangeText={(text) => {
              setInputKey(text);
              if (testResult) setTestResult(null);
            }}
            placeholder={provider.placeholder}
            placeholderTextColor={colors.fgTertiary}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 font-sans text-sm text-fg py-1"
            style={noFocusRing}
            selectionColor={colors.accent}
          />
          <Pressable
            onPress={() => setShowKey(!showKey)}
            hitSlop={8}
            className="p-1.5 ml-1"
            accessibilityLabel={showKey ? 'Hide API Key' : 'Show API Key'}
          >
            {showKey ? (
              <EyeOff size={15} color={colors.fgSecondary} />
            ) : (
              <Eye size={15} color={colors.fgSecondary} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Test / Feedback Message */}
      {testResult && (
        <View
          className="p-3 rounded-md flex-row items-start gap-2 border"
          style={{
            backgroundColor: testResult.success ? `${colors.accent}1A` : `${colors.error}1A`,
            borderColor: testResult.success ? `${colors.accent}33` : `${colors.error}33`,
          }}
        >
          {testResult.success ? (
            <Icon name="check" size={15} color={colors.accent} />
          ) : (
            <AlertCircle size={15} color={colors.error} style={{ marginTop: 2 }} />
          )}
          <Text
            className="font-sans text-sm flex-1"
            style={{ color: testResult.success ? colors.accent : colors.error }}
          >
            {testResult.message}
          </Text>
        </View>
      )}

      {/* Action Buttons */}
      <View className="flex-row items-center gap-2 pt-1">
        <Button onPress={handleSave} disabled={isSaving} variant="primary" size="sm" className="flex-1" icon="check">
          {isSaving ? 'Saving...' : 'Save'}
        </Button>

        <Button
          onPress={handleTest}
          disabled={isTesting || !inputKey.trim()}
          variant="quiet"
          size="sm"
          icon="sparkles"
        >
          {isTesting ? 'Testing...' : 'Test'}
        </Button>

        {source === 'custom' && (
          <IconButton icon="trash" label="Clear custom key" onPress={handleClear} />
        )}
      </View>

      {/* Link to get key */}
      <Pressable
        onPress={openGoogleAIStudio}
        className="flex-row items-center justify-between pt-2 border-t border-border/40"
      >
        <Text className="flex-1 font-sans text-sm text-fg-secondary mr-3">
          Need a key? It's free.
        </Text>
        <View className="flex-row items-center">
          <Text className="font-sans-medium text-sm text-accent mr-1">{provider.consoleName}</Text>
          <Icon name="arrowUpRight" size={12} color={colors.accent} />
        </View>
      </Pressable>
    </View>
  );
}

// What leaves the phone, and when: said plainly, every case.
const PRIVACY_FACTS = [
  {
    title: 'With Gemini on',
    body:
      'Sent to Google with your key: the text of each new note, the recording of a voice note, and any photo on it; the title and description of a page you saved a link to, as your phone read them, so the note can be understood; the titles and a line from your recently active threads, so it can file the note; your question and the notes that best match it, when you ask; note text for meaning search, and the notes of a thread when you ask to organise them. On a free key, Google may use what you send to improve its products, and people may review it. Offline, none of this happens.',
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
