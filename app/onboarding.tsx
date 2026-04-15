import React from 'react';
import { View, Text, ScrollView, SafeAreaView, Platform } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MotiView } from 'moti';
import { ZenButton } from '@/components/ZenButton';
import { Mic, PenLine, Sparkles } from 'lucide-react-native';

export const ONBOARDING_KEY = 'mnemo-onboarded';

const features = [
  {
    Icon: Mic,
    title: 'Speak your mind',
    description:
      'Record a voice note before stepping away. Mnemo captures every word in any language.',
  },
  {
    Icon: Sparkles,
    title: 'AI structures it for you',
    description:
      'Your ramble becomes a clean summary, next steps, and key resources — automatically.',
  },
  {
    Icon: PenLine,
    title: 'Pick up where you left off',
    description:
      'Open the app, read the summary, and you\'re instantly back in context.',
  },
];

export default function OnboardingScreen() {
  const handleGetStarted = async () => {
    try {
      if (Platform.OS === 'web') {
        localStorage.setItem(ONBOARDING_KEY, 'true');
      } else {
        await SecureStore.setItemAsync(ONBOARDING_KEY, 'true');
      }
    } catch {
      // Non-critical — proceed anyway.
    }
    router.replace('/(tabs)');
  };

  return (
    <View className="flex-1 bg-bg">
      <SafeAreaView className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: 32,
            paddingTop: 64,
            paddingBottom: 48,
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600 }}
            className="mb-16"
          >
            <Text className="text-5xl mb-5">🍃</Text>
            <Text className="text-4xl font-serif text-fg leading-tight mb-4">
              Welcome to{'\n'}Mnemo
            </Text>
            <Text className="font-sans text-base text-fg-muted leading-relaxed">
              Your personal memory for deep work — capture thoughts before you
              leave, and step back in instantly.
            </Text>
          </MotiView>

          {/* Feature bullets */}
          <View className="gap-8 mb-16">
            {features.map(({ Icon, title, description }, i) => (
              <MotiView
                key={i}
                from={{ opacity: 0, translateX: -16 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'timing', duration: 500, delay: 300 + i * 150 }}
                className="flex-row items-start gap-4"
              >
                <View className="w-12 h-12 rounded-full bg-accent/15 items-center justify-center mt-0.5 flex-shrink-0">
                  <Icon size={22} color="#8B9E7E" strokeWidth={1.6} />
                </View>
                <View className="flex-1">
                  <Text className="font-sans-semi text-base text-fg mb-1">
                    {title}
                  </Text>
                  <Text className="font-sans text-sm text-fg-muted leading-relaxed">
                    {description}
                  </Text>
                </View>
              </MotiView>
            ))}
          </View>

          {/* CTA */}
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 900 }}
          >
            <ZenButton
              onPress={handleGetStarted}
              title="Get started"
              variant="primary"
              size="lg"
              fullWidth
              hapticIntensity="heavy"
            />
          </MotiView>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
