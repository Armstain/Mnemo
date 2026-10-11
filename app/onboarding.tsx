import React from 'react';
import { View, Text, ScrollView, Platform, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { MotiView } from 'moti';

import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { EASE_OUT, REDUCED } from '@/utils/motion';
import { Button } from '@/components/ui/Button';
import { FirstCaptureStep, NudgeStep, RevealStep } from '@/components/OnboardingSteps';
import { OpenRing } from '@/components/ui/ThreadRing';
import { useThemeColors } from '@/hooks/use-theme';

export const ONBOARDING_KEY = 'mnemo-onboarded';

const features: { title: string; description: string }[] = [
  {
    title: 'Capture it',
    description: 'Talk or type. A thought is saved before it can slip away, even offline.',
  },
  {
    title: 'Let it settle',
    description: 'Mnemo writes down where you left off and the one thing to do next.',
  },
  {
    title: 'Pick the thread back up',
    description: 'Open the app, see what you dropped, resume it. No restart friction.',
  },
];

// Onboarding is seen once, so it gets the delight budget: a longer hero
// and a staged reveal. Reduce Motion keeps the staging (it explains the
// page) but drops the travel, and shortens everything to REDUCED.
const ONBOARD_HERO_MS = 600;
const ONBOARD_FEATURE_MS = 500;
const ONBOARD_FEATURE_STEP_MS = 150;

export default function OnboardingScreen() {
  const reduceMotion = useReduceMotion();
  const ONBOARD_HERO = reduceMotion
    ? REDUCED
    : { type: 'timing' as const, duration: ONBOARD_HERO_MS, easing: EASE_OUT };
  // The CTA lands with the last feature rather than 400ms after it — the
  // primary action shouldn't be the last thing to arrive on first run.
  const ONBOARD_CTA = reduceMotion
    ? { ...REDUCED, delay: 120 }
    : { type: 'timing' as const, duration: ONBOARD_FEATURE_MS, delay: 750, easing: EASE_OUT };
  const onboardFeature = (i: number) =>
    reduceMotion
      ? { ...REDUCED, delay: 60 + i * 60 }
      : {
          type: 'timing' as const,
          duration: ONBOARD_FEATURE_MS,
          delay: 300 + i * ONBOARD_FEATURE_STEP_MS,
          easing: EASE_OUT,
        };

  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const { width, height } = useWindowDimensions();
  // Compact = short phones (SE-class, ~667pt) where generous fixed margins
  // push the CTA below the fold; narrow = small-width phones (~320-360pt)
  // where the default horizontal padding eats too much of the content.
  const isCompact = height < 700;
  const isNarrow = width < 360;
  const horizontalPadding = isNarrow ? 24 : 32;
  const featuresGap = isCompact ? 'gap-6' : 'gap-8';
  const featuresSpacing = isCompact ? 'mb-10' : 'mb-16';
  const heroTitleSize = isCompact ? 38 : 46;
  // Welcome → first capture → see it structured → nudge opt-in → app.
  // Web has no local notifications, so it skips the nudge step.
  const [step, setStep] = React.useState<'welcome' | 'capture' | 'reveal' | 'nudges'>('welcome');
  const [capturedId, setCapturedId] = React.useState<string | null>(null);

  const finish = async () => {
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

  const afterCapture = () => (Platform.OS === 'web' ? finish() : setStep('nudges'));

  if (step !== 'welcome') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {step === 'capture' && (
          <FirstCaptureStep
            onCaptured={(id) => {
              setCapturedId(id);
              setStep('reveal');
            }}
            onSkip={afterCapture}
          />
        )}
        {step === 'reveal' && capturedId && (
          <RevealStep itemId={capturedId} onContinue={afterCapture} />
        )}
        {step === 'nudges' && <NudgeStep itemId={capturedId} onDone={finish} />}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <View className="flex-1">
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, 24) + (isCompact ? 24 : 48),
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero — full-bleed ink panel with the mark cropped off its corner */}
          <View
            className="overflow-hidden mb-10"
            style={{
              backgroundColor: colors.hero,
              paddingHorizontal: horizontalPadding,
              paddingTop: insets.top + (isCompact ? 40 : 72),
              paddingBottom: isCompact ? 36 : 48,
              borderBottomLeftRadius: 36,
              borderBottomRightRadius: 36,
            }}
          >
            <MotiView
              from={{ opacity: 0, rotate: '-20deg' }}
              animate={{ opacity: 0.14, rotate: '0deg' }}
              transition={{ ...ONBOARD_HERO, duration: reduceMotion ? ONBOARD_HERO.duration : 1200 }}
              pointerEvents="none"
              style={{ position: 'absolute', top: insets.top - 30, right: -90 }}
            >
              <OpenRing size={300} color={colors.onHero} weight={0.1} />
            </MotiView>

            <MotiView
              from={{ opacity: 0, translateY: 20 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={ONBOARD_HERO}
            >
              <View className="mb-8">
                <OpenRing size={40} color={colors.heroAccent} weight={0.17} />
              </View>
              <Text
                className="font-display leading-tight"
                style={{ color: colors.onHero, fontSize: heroTitleSize, letterSpacing: -0.8 }}
              >
                Never lose{'\n'}the{' '}
                <Text className="font-quote" style={{ color: colors.heroAccent }}>
                  thread
                </Text>
                .
              </Text>
              <Text className="font-sans text-body leading-relaxed mt-4" style={{ color: colors.onHeroMuted }}>
                Pause anything. Pick it back up in seconds,{'\n'}knowing exactly where you were.
              </Text>
            </MotiView>
          </View>

          {/* How it works — numbered, editorial */}
          <View className={`${featuresGap} ${featuresSpacing}`} style={{ paddingHorizontal: horizontalPadding }}>
            {features.map((feature, i) => (
              <MotiView
                key={i}
                from={{ opacity: 0, translateX: -16 }}
                animate={{ opacity: 1, translateX: 0 }}
                transition={onboardFeature(i)}
                className="flex-row items-start"
              >
                <Text className="font-display w-12" style={{ color: colors.accent, fontSize: 22, lineHeight: 26 }}>
                  {String(i + 1).padStart(2, '0')}
                </Text>
                <View className="flex-1">
                  <Text className="font-sans-semi text-base text-fg mb-1">{feature.title}</Text>
                  <Text className="font-sans text-sm text-fg-muted leading-relaxed">{feature.description}</Text>
                </View>
              </MotiView>
            ))}
          </View>

          {/* CTA */}
          <MotiView
            from={{ opacity: 0, translateY: 16 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={ONBOARD_CTA}
            style={{ paddingHorizontal: horizontalPadding }}
          >
            <Button onPress={() => setStep('capture')} variant="primary" size="lg" fullWidth>
              Get started
            </Button>
          </MotiView>
        </ScrollView>
    </View>
    </View>
  );
}
