import { View, Pressable } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { Key, Eye, EyeOff, AlertCircle } from 'lucide-react-native';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Button, IconButton } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';
import { noFocusRing } from '@/utils/web';
import { Icon } from '@/components/ui/Icon';
import { useThemeColors } from '@/hooks/use-theme';
import {
  getActiveApiKey,
  getActiveGroqApiKey,
  saveApiKey,
  saveGroqApiKey,
  validateApiKey,
  validateGroqApiKey,
  loadStoredApiKeys,
} from '@/lib/api-key';

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

export const GROQ: KeyProvider = {
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

export function ApiKeyConfigCard({ provider = GEMINI }: { provider?: KeyProvider }) {
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
