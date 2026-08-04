import React from 'react';
import { View, Text, ScrollView, Platform, Image, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MotiView } from 'moti';
import { AmbientGlow } from '@/components/ui/AmbientGlow';
import { ZenButton } from '@/components/ZenButton';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { PenLine, RefreshCw, Sparkles } from 'lucide-react-native';

export const ONBOARDING_KEY = 'mnemo-onboarded';

const features = [
  {
    Icon: PenLine,
    title: 'Capture anything',
    description:
      'Notes, checklists, voice memos — one tap. Works completely offline.',
  },
  {
    Icon: RefreshCw,
    title: 'Resume instantly',
    description:
      'See exactly where you left off and what to do next. No more restart friction.',
  },
  {
    Icon: Sparkles,
    title: 'AI enhances, optionally',
    description:
      'Smart summaries and next steps when you want them. Your notes work perfectly without AI.',
  },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const theme = useThemeName();
  const { width, height } = useWindowDimensions();
  // Compact = short phones (SE-class, ~667pt) where generous fixed margins
  // push the CTA below the fold; narrow = small-width phones (~320-360pt)
  // where the default horizontal padding eats too much of the content.
  const isCompact = height < 700;
  const isNarrow = width < 360;
  const horizontalPadding = isNarrow ? 24 : 32;
  const heroSpacing = isCompact ? 'mb-10' : 'mb-16';
  const featuresGap = isCompact ? 'gap-6' : 'gap-8';
  const featuresSpacing = isCompact ? 'mb-10' : 'mb-16';
  const heroTitleSize = isCompact ? 'text-3xl' : 'text-4xl';
  const logoSize = isCompact ? 52 : 64;
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
    <AmbientGlow>
    <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingHorizontal: horizontalPadding,
            paddingTop: insets.top + (isCompact ? 32 : 64),
            paddingBottom: Math.max(insets.bottom, 24) + (isCompact ? 24 : 48),
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <MotiView
            from={{ opacity: 0, translateY: 20 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600 }}
            className={heroSpacing}
          >
            <Image
              source={
                theme === 'dark'
                  ? require('@/assets/Mnemo_logo_dark.png')
                  : require('@/assets/Mnemo_logo_light.png')
              }
              style={{ width: logoSize, height: logoSize, marginBottom: isCompact ? 14 : 20 }}
              resizeMode="contain"
              accessibilityLabel="Mnemo logo"
            />
            <Text className={`${heroTitleSize} font-serif text-fg leading-tight mb-4`}>
              Never lose track{'\n'}of life again
            </Text>
            <Text className="font-sans text-base text-fg-muted leading-relaxed">
              Pause anything. Resume instantly.{'\n'}
              Your in-progress life, organized.
            </Text>
          </MotiView>

          {/* Feature bullets */}
          <View className={`${featuresGap} ${featuresSpacing}`}>
            {features.map(({ Icon, title, description }, i) => (
              <MotiView
                key={i}
                from={{ opacity: 0, translateX: -16 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={{ type: 'timing', duration: 500, delay: 300 + i * 150 }}
                className="flex-row items-start gap-4"
              >
                <View className="w-12 h-12 rounded-full bg-accent/15 items-center justify-center mt-0.5 flex-shrink-0">
                  <Icon size={22} color={colors.accent} strokeWidth={1.6} />
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
    </View>
    </AmbientGlow>
  );
}
