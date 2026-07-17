import { StatusBar } from 'expo-status-bar';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import { Info, Key, Mic, Moon, Shield, Smartphone, Sun } from 'lucide-react-native';
import Constants from 'expo-constants';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import {
  useThemeColors,
  useThemeName,
  useThemePreference,
  type ThemePreference,
} from '@/hooks/use-theme';

const THEME_OPTIONS: { key: ThemePreference; label: string; icon: typeof Sun }[] = [
  { key: 'system', label: 'System', icon: Smartphone },
  { key: 'light', label: 'Light', icon: Sun },
  { key: 'dark', label: 'Dark', icon: Moon },
];

export default function ModalScreen() {
  const insets = useSafeAreaInsets();
  const apiKeyConfigured = !!process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  const colors = useThemeColors();
  const theme = useThemeName();
  const { preference, setPreference } = useThemePreference();

  return (
    <AmbientGlow>
    <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 24,
            paddingTop: insets.top + 32,
            paddingBottom: Math.max(insets.bottom, 24) + 48
          }}
          showsVerticalScrollIndicator={false}
        >
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            className="mb-10"
          >
            <Text className="text-3xl font-sans-medium text-fg mb-1">Settings</Text>
            <Text className="font-sans text-sm text-fg-tertiary">
              Mnemo v{Constants.expoConfig?.version ?? '1.0.0'}
            </Text>
          </MotiView>

          {/* Appearance */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 50 }}
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
                    className={`flex-1 flex-row items-center justify-center py-2.5 rounded-xl ${
                      selected ? 'bg-surface-warm border border-border/60' : ''
                    } active:opacity-70`}
                  >
                    <Icon
                      size={14}
                      color={selected ? colors.accent : colors.fgTertiary}
                      strokeWidth={2}
                    />
                    <Text
                      className={`font-sans-medium text-xs ml-1.5 ${
                        selected ? 'text-fg' : 'text-fg-tertiary'
                      }`}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </MotiView>

          {/* AI */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 100 }}
            className="gap-3 mb-10"
          >
            <Text className="font-sans-medium text-xs text-fg-tertiary tracking-wide mb-1">
              AI CONFIGURATION
            </Text>

            <View className="bg-surface rounded-2xl p-5 border border-border/50">
              <View className="flex-row items-center mb-3">
                <Key size={15} color={colors.accent} />
                <Text className="font-sans-semi text-sm text-fg ml-2">Gemini API Key</Text>
              </View>
              <View
                className={`px-3 py-1.5 rounded-full self-start mb-3 ${
                  apiKeyConfigured ? 'bg-accent/15' : 'bg-error/10'
                }`}
              >
                <Text
                  className={`font-sans-medium text-xs ${
                    apiKeyConfigured ? 'text-accent' : 'text-error'
                  }`}
                >
                  {apiKeyConfigured ? 'Configured' : 'Not configured'}
                </Text>
              </View>
              <Text className="font-sans text-xs text-fg-secondary leading-relaxed">
                {apiKeyConfigured
                  ? 'A key is set. To rotate it, update EXPO_PUBLIC_GEMINI_API_KEY in your .env file and rebuild.'
                  : 'Add EXPO_PUBLIC_GEMINI_API_KEY to your .env file (see .env.example) and rebuild to enable AI features.'}
              </Text>
            </View>

            <View className="bg-surface rounded-2xl p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Mic size={15} color={colors.accent} />
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
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 200 }}
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
          </MotiView>

          {/* About */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 300 }}
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
    </AmbientGlow>
  );
}
