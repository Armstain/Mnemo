import { StatusBar } from 'expo-status-bar';
import { Platform, View, Text, ScrollView, SafeAreaView } from 'react-native';
import { MotiView } from 'moti';
import { Info, Key, Mic, Shield } from 'lucide-react-native';
import Constants from 'expo-constants';

export default function ModalScreen() {
  const apiKeyConfigured = !!process.env.EXPO_PUBLIC_GEMINI_API_KEY;

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            className="mb-10"
          >
            <Text className="text-3xl font-serif text-fg mb-1">Settings</Text>
            <Text className="font-sans text-sm text-fg-muted">
              Mnemo v{Constants.expoConfig?.version ?? '1.0.0'}
            </Text>
          </MotiView>

          {/* AI */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 100 }}
            className="gap-3 mb-10"
          >
            <Text className="font-sans-medium text-xs text-fg-muted tracking-wide mb-1">
              AI CONFIGURATION
            </Text>

            <View className="bg-surface rounded-[16px] p-5 border border-border/50">
              <View className="flex-row items-center mb-3">
                <Key size={15} color="#8B9E7E" />
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
              <Text className="font-sans text-xs text-fg-muted leading-relaxed">
                {apiKeyConfigured
                  ? 'A key is set. To rotate it, update EXPO_PUBLIC_GEMINI_API_KEY in your .env file and rebuild.'
                  : 'Add EXPO_PUBLIC_GEMINI_API_KEY to your .env file (see .env.example) and rebuild to enable AI features.'}
              </Text>
            </View>

            <View className="bg-surface rounded-[16px] p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Mic size={15} color="#8B9E7E" />
                <Text className="font-sans-semi text-sm text-fg ml-2">Offline behaviour</Text>
              </View>
              <Text className="font-sans text-xs text-fg-muted leading-relaxed">
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
            <Text className="font-sans-medium text-xs text-fg-muted tracking-wide mb-1">
              PRIVACY
            </Text>

            <View className="bg-surface rounded-[16px] p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Shield size={15} color="#8B9E7E" />
                <Text className="font-sans-semi text-sm text-fg ml-2">Your data</Text>
              </View>
              <Text className="font-sans text-xs text-fg-muted leading-relaxed">
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
            <Text className="font-sans-medium text-xs text-fg-muted tracking-wide mb-1">
              ABOUT
            </Text>

            <View className="bg-surface rounded-[16px] p-5 border border-border/50">
              <View className="flex-row items-center mb-2">
                <Info size={15} color="#8B9E7E" />
                <Text className="font-sans-semi text-sm text-fg ml-2">Mnemo</Text>
              </View>
              <Text className="font-sans text-xs text-fg-muted leading-relaxed">
                Named after Mnemosyne, the Greek goddess of memory. Mnemo helps you leave a mental
                breadcrumb before stepping away from deep work, so you can pick up exactly where you
                left off.
              </Text>
            </View>
          </MotiView>
        </ScrollView>
      </SafeAreaView>

      <StatusBar style={Platform.OS === 'ios' ? 'light' : 'auto'} />
    </View>
  );
}
