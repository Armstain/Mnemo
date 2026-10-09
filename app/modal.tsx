import { StatusBar } from 'expo-status-bar';
import { useEnter } from '@/utils/motion';
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Platform, Switch, Linking } from 'react-native';
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
import { Button, IconButton } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
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
  type NudgePrefs,
  type NudgeTime,
} from '@/lib/nudges';
import {
  getActiveApiKey,
  getApiKeySource,
  saveApiKey,
  validateApiKey,
  getActiveGroqApiKey,
  getGroqApiKeySource,
  saveGroqApiKey,
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
  const { items } = useMnemoStore();
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [granted, setGranted] = useState(false);
  // Set once a turn-on attempt comes back refused — at that point only
  // the OS Settings app can change it, so say so instead of silently
  // leaving the switch off.
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    loadNudgePrefs().then(setPrefs);
    hasNudgePermission().then(setGranted);
  }, []);

  const apply = async (next: NudgePrefs) => {
    setPrefs(next);
    await saveNudgePrefs(next);
    scheduleNudges(items);
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

  if (!prefs) return null;
  const isOn = prefs.enabled && granted;

  return (
    <View className="bg-surface rounded-2xl p-5 border border-border/50 gap-4">
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

      <Text className="font-sans text-xs text-fg-secondary leading-relaxed">
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
        </View>
      )}

      {blocked && (
        <View className="flex-row items-center justify-between gap-3">
          <Text className="font-sans text-xs text-fg-tertiary flex-1">
            Notifications are off for Mnemo in your phone's settings.
          </Text>
          <Button variant="quiet" size="sm" onPress={() => Linking.openSettings()}>
            Open settings
          </Button>
        </View>
      )}
    </View>
  );
}

function ApiKeyConfigCard() {
  const colors = useThemeColors();
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [source, setSource] = useState<'custom' | 'env' | 'none'>('none');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      await loadStoredApiKeys();
      setInputKey(getActiveApiKey());
      setSource(getApiKeySource());
    })();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setTestResult(null);
    try {
      await saveApiKey(inputKey);
      const newSource = getApiKeySource();
      setSource(newSource);
      if (inputKey.trim()) {
        setTestResult({ success: true, message: 'Key saved securely!' });
      } else {
        setTestResult({ success: true, message: 'Custom key cleared.' });
      }
    } catch (e: any) {
      setTestResult({ success: false, message: 'Failed to save key.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await validateApiKey(inputKey);
    setIsTesting(false);
    if (result.valid) {
      setTestResult({ success: true, message: 'Connection successful! Gemini API is working.' });
    } else {
      setTestResult({ success: false, message: result.error || 'Validation failed.' });
    }
  };

  const handleClear = async () => {
    setInputKey('');
    await saveApiKey('');
    setSource(getApiKeySource());
    setInputKey(getActiveApiKey());
    setTestResult({ success: true, message: 'Custom key reset.' });
  };

  const openGoogleAIStudio = () => {
    WebBrowser.openBrowserAsync('https://aistudio.google.com/app/apikey');
  };

  return (
    <View className="bg-surface rounded-2xl p-5 border border-border/50 gap-4">
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Key size={16} color={colors.accent} strokeWidth={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Gemini API key</Text>
        </View>

        <Pill tone={source === 'none' ? colors.error : colors.accent} size="sm">
          {source === 'custom' ? 'Your key' : source === 'env' ? 'Built-in key' : 'Not set'}
        </Pill>
      </View>

      {/* Input Field */}
      <View className="gap-1.5">
        <View className="flex-row items-center bg-surface-warm rounded-md border border-border/60 px-3.5 py-2">
          <TextInput
            value={inputKey}
            onChangeText={(text) => {
              setInputKey(text);
              if (testResult) setTestResult(null);
            }}
            placeholder="AIzaSy..."
            placeholderTextColor={colors.fgTertiary}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 font-sans text-xs text-fg py-1"
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
            className="font-sans text-xs flex-1"
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
        <Text className="flex-1 font-sans text-xs text-fg-secondary mr-3">
          Need a key? It's free.
        </Text>
        <View className="flex-row items-center">
          <Text className="font-sans-medium text-xs text-accent mr-1">Google AI Studio</Text>
          <Icon name="arrowUpRight" size={12} color={colors.accent} />
        </View>
      </Pressable>
    </View>
  );
}

function GroqApiKeyConfigCard() {
  const colors = useThemeColors();
  const [inputKey, setInputKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [source, setSource] = useState<'custom' | 'env' | 'none'>('none');
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    (async () => {
      await loadStoredApiKeys();
      setInputKey(getActiveGroqApiKey());
      setSource(getGroqApiKeySource());
    })();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setTestResult(null);
    try {
      await saveGroqApiKey(inputKey);
      const newSource = getGroqApiKeySource();
      setSource(newSource);
      if (inputKey.trim()) {
        setTestResult({ success: true, message: 'Groq key saved securely!' });
      } else {
        setTestResult({ success: true, message: 'Custom Groq key cleared.' });
      }
    } catch (e: any) {
      setTestResult({ success: false, message: 'Failed to save Groq key.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    const result = await validateGroqApiKey(inputKey);
    setIsTesting(false);
    if (result.valid) {
      setTestResult({ success: true, message: 'Groq API connected! Whisper transcription active.' });
    } else {
      setTestResult({ success: false, message: result.error || 'Groq validation failed.' });
    }
  };

  const handleClear = async () => {
    setInputKey('');
    await saveGroqApiKey('');
    setSource(getGroqApiKeySource());
    setInputKey(getActiveGroqApiKey());
    setTestResult({ success: true, message: 'Custom Groq key reset.' });
  };

  const openGroqConsole = () => {
    WebBrowser.openBrowserAsync('https://console.groq.com/keys');
  };

  return (
    <View className="bg-surface rounded-2xl p-5 border border-border/50 gap-4">
      {/* Header */}
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center">
          <Icon name="mic" size={16} color={colors.accent} stroke={2} />
          <Text className="font-sans-semi text-sm text-fg ml-2">Groq API key</Text>
        </View>

        <Pill tone={source === 'none' ? colors.error : colors.accent} size="sm">
          {source === 'custom' ? 'Your key' : source === 'env' ? 'Built-in key' : 'Not set'}
        </Pill>
      </View>

      {/* Input Field */}
      <View className="gap-1.5">
        <View className="flex-row items-center bg-surface-warm rounded-md border border-border/60 px-3.5 py-2">
          <TextInput
            value={inputKey}
            onChangeText={(text) => {
              setInputKey(text);
              if (testResult) setTestResult(null);
            }}
            placeholder="gsk_..."
            placeholderTextColor={colors.fgTertiary}
            secureTextEntry={!showKey}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1 font-sans text-xs text-fg py-1"
            selectionColor={colors.accent}
          />
          <Pressable
            onPress={() => setShowKey(!showKey)}
            hitSlop={8}
            className="p-1.5 ml-1"
            accessibilityLabel={showKey ? 'Hide Groq API Key' : 'Show Groq API Key'}
          >
            {showKey ? (
              <EyeOff size={15} color={colors.fgSecondary} />
            ) : (
              <Eye size={15} color={colors.fgSecondary} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Feedback Message */}
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
            className="font-sans text-xs flex-1"
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
          <IconButton icon="trash" label="Clear custom Groq key" onPress={handleClear} />
        )}
      </View>

      {/* Link to get key */}
      <Pressable
        onPress={openGroqConsole}
        className="flex-row items-center justify-between pt-2 border-t border-border/40"
      >
        <Text className="flex-1 font-sans text-xs text-fg-secondary mr-3">
          Backup voice transcription. Free.
        </Text>
        <View className="flex-row items-center">
          <Text className="font-sans-medium text-xs text-accent mr-1">console.groq.com</Text>
          <Icon name="arrowUpRight" size={12} color={colors.accent} />
        </View>
      </Pressable>
    </View>
  );
}

export default function ModalScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();
  const { clearAllData } = useMnemoStore();
  const [isClearing, setIsClearing] = useState(false);

  // No undo here, unlike a single-item delete — wiping every note and
  // recording at once needs a real confirmation, not a grace window.
  const handleClearAllData = () => {
    Alert.alert(
      'Clear all data',
      'This permanently deletes every note, checklist, and voice recording on this device. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
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
        },
      ],
    );
  };

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
            <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
              APPEARANCE
            </Text>

            <View className="bg-surface rounded-2xl p-2 border border-border/50 flex-row gap-1">
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
                      className="font-sans-medium text-xs ml-1.5"
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
              <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
                NUDGES
              </Text>

              <NudgeSettingsCard />
            </MotiView>
          )}

          {/* AI */}
          <MotiView {...enter.rise(1)}
            className="gap-3 mb-10"
          >
            <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
              AI CONFIGURATION
            </Text>

            <ApiKeyConfigCard />
            <GroqApiKeyConfigCard />

            <View className="bg-surface rounded-2xl p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Icon name="mic" size={15} color={colors.accent} />
                <Text className="font-sans-semi text-sm text-fg ml-2">Offline behaviour</Text>
              </View>
              <Text className="font-sans text-xs text-fg-secondary leading-relaxed">
                When you record or write a note without connectivity, it is saved immediately and
                processed by AI automatically the next time you open the app with a connection.
                You will never lose a note.
              </Text>
            </View>
          </MotiView>

          {/* Privacy */}
          <MotiView {...enter.rise(2)}
            className="gap-3 mb-10"
          >
            <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
              PRIVACY
            </Text>

            <View className="bg-surface rounded-2xl p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Shield size={15} color={colors.accent} />
                <Text className="font-sans-semi text-sm text-fg ml-2">Your data</Text>
              </View>
              <Text className="font-sans text-xs text-fg-secondary leading-relaxed">
                Notes are stored locally on your device using encrypted secure storage. Audio and
                text are sent to Google Gemini only for AI processing and are not retained by Mnemo
                on any server.
              </Text>
            </View>

            <Pressable
              onPress={handleClearAllData}
              disabled={isClearing}
              accessibilityRole="button"
              accessibilityLabel="Clear all data"
              className={`bg-surface rounded-2xl p-5 border border-error/30 flex-row items-center ${
                isClearing ? 'opacity-60' : 'active:opacity-80'
              }`}
            >
              <Icon name="trash" size={15} color={colors.error} />
              <View className="ml-2 flex-1">
                <Text className="font-sans-semi text-sm text-error">Clear all data</Text>
                <Text className="font-sans text-xs text-fg-tertiary mt-0.5">
                  Permanently deletes every note and recording on this device
                </Text>
              </View>
              {isClearing && <ActivityIndicator size="small" color={colors.error} />}
            </Pressable>
          </MotiView>

          {/* About */}
          <MotiView {...enter.rise(2)}
            className="gap-3"
          >
            <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
              ABOUT
            </Text>

            <View className="bg-surface rounded-2xl p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Info size={15} color={colors.accent} />
                <Text className="font-sans-semi text-sm text-fg ml-2">Mnemo</Text>
              </View>
              <Text className="font-sans text-xs text-fg-secondary leading-relaxed">
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
