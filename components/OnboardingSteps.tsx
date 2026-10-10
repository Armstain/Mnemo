import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { Bell } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { RecordButton } from '@/components/ui/RecordButton';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useQuickRecording } from '@/hooks/use-quick-recording';
import { useThemeColors } from '@/hooks/use-theme';
import { resolvePendingEntry } from '@/lib/capture';
import { buildBlocks } from '@/lib/threads';
import { NUDGE_TIMES, requestNudgePermission, saveNudgePrefs } from '@/lib/nudges';
import { useEnter } from '@/utils/motion';

// The steps after onboarding's welcome page. The goal is to get to the
// first real capture — the moment the app makes sense — before the user
// ever sees the home screen, instead of describing capture and hoping
// they try it later.

/** How long the reveal waits on AI structuring before saying "saved, tidying later". */
const STRUCTURING_PATIENCE_MS = 15000;

function StepFrame({
  onSkip,
  children,
}: {
  onSkip?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: 32,
          paddingTop: insets.top + 12,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        }}
      >
        <View className="h-11 flex-row justify-end items-center mb-4">
          {onSkip ? (
            <Button variant="ghost" size="sm" onPress={onSkip}>
              Skip
            </Button>
          ) : null}
        </View>
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ─── Step: first capture ────────────────────────────────────────

export function FirstCaptureStep({
  onCaptured,
  onSkip,
}: {
  onCaptured: (itemId: string) => void;
  onSkip: () => void;
}) {
  const enter = useEnter();
  const colors = useThemeColors();
  const store = useMnemoStore();
  const recording = useQuickRecording();
  const [mode, setMode] = useState<'voice' | 'type'>('voice');
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!recording.isRecording) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [recording.isRecording]);

  // Tap to start, tap to finish — not hold-to-record. The first tap is
  // also when the OS asks for the mic, and a permission dialog landing
  // mid-hold would break a hold gesture.
  const toggleRecording = async () => {
    if (recording.phase === 'finishing') return;
    if (!recording.isRecording) {
      setHint(null);
      const result = await recording.start();
      if (result === 'ok') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setHint(
        result === 'permission-denied'
          ? "Mnemo can't use the microphone, so type it instead."
          : "The microphone didn't start, so type it instead.",
      );
      setMode('type');
      return;
    }
    const saved = await recording.finish('general', true);
    if (saved) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCaptured(saved.threadId);
    } else {
      setHint('That was a little short. Tap and try again, or type it.');
    }
  };

  const discardRecording = async () => {
    if (recording.isRecording) await recording.finish('general', false);
  };

  const switchToTyping = async () => {
    await discardRecording();
    setHint(null);
    setMode('type');
  };

  const handleSkip = async () => {
    await discardRecording();
    onSkip();
  };

  // Same instant-save path as the capture screen: the raw text lands now,
  // AI structuring patches it in place when it returns.
  const saveText = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const firstLine = trimmed.split('\n')[0];
    const { thread, entry } = store.createThread(
      {
        title: firstLine.length > 50 ? `${firstLine.substring(0, 50)}…` : firstLine,
        category: 'general',
        tags: [],
        status: 'active',
        pending: true,
      },
      {
        source: 'text',
        transcript: trimmed,
        blocks: buildBlocks({ text: trimmed }),
        pending: true,
        pendingRawText: trimmed,
      },
    );
    resolvePendingEntry(entry, store);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCaptured(thread.id);
  };

  const recordLabel =
    recording.phase === 'finishing'
      ? 'Saving…'
      : recording.isRecording
        ? `Listening · ${formatElapsed(elapsed)} · tap when you're done`
        : 'Tap to start';

  return (
    <StepFrame onSkip={handleSkip}>
      <MotiView {...enter.rise(0)}>
        <Text className="text-3xl font-serif text-fg leading-tight mb-3">
          What's on your mind{'\n'}right now?
        </Text>
        <Text className="font-sans text-base text-fg-muted leading-relaxed">
          Say it the way you'd tell a friend: a half-done task, an idea, something to pick up
          later. Mnemo turns it into a note with a next step.
        </Text>
      </MotiView>

      {mode === 'voice' ? (
        <>
          <MotiView {...enter.fade(1)} className="flex-1 items-center justify-center py-12">
            <RecordButton
              size={104}
              recording={recording.isRecording}
              label={recordLabel}
              onPress={toggleRecording}
            />
          </MotiView>
          {hint ? (
            <Text className="font-sans text-sm text-fg-secondary text-center mb-4">{hint}</Text>
          ) : null}
          <MotiView {...enter.fade(2)}>
            <Button variant="quiet" size="md" icon="pencil" fullWidth onPress={switchToTyping}>
              Prefer typing?
            </Button>
          </MotiView>
        </>
      ) : (
        // Save sits right under the input, not in a bottom footer, so it
        // stays above the keyboard on Android too (see app/capture.tsx).
        <MotiView {...enter.fade(0)} className="mt-8 gap-3">
          {hint ? <Text className="font-sans text-sm text-fg-secondary">{hint}</Text> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="Finish the intro for Thursday's deck, then send it to Sam…"
            placeholderTextColor={colors.fgTertiary}
            accessibilityLabel="Your first thought"
            className="font-sans text-base text-fg bg-surface rounded-lg border border-border/60 p-4"
            style={{ minHeight: 128, textAlignVertical: 'top' }}
          />
          <Button variant="primary" size="lg" fullWidth disabled={!text.trim()} onPress={saveText}>
            Save thought
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="mic"
            onPress={() => {
              setHint(null);
              setMode('voice');
            }}
          >
            Use my voice instead
          </Button>
        </MotiView>
      )}
    </StepFrame>
  );
}

// ─── Step: reveal ───────────────────────────────────────────────

export function RevealStep({ itemId, onContinue }: { itemId: string; onContinue: () => void }) {
  const enter = useEnter();
  const colors = useThemeColors();
  const { items } = useMnemoStore();
  const item = items.find((i) => i.id === itemId);
  const [waitedOut, setWaitedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), STRUCTURING_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  const structured = !!item && !item.pending;
  const stillWorking = !!item?.pending && !waitedOut;

  useEffect(() => {
    if (structured) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [structured]);

  const headline = structured ? "Here's how Mnemo\nremembers it" : stillWorking ? 'Got it.' : 'Saved.';
  const body = structured
    ? "Next time you open Mnemo, it's waiting on your home screen, one tap from where you left off."
    : stillWorking
      ? 'Turning that into a note…'
      : "Mnemo will tidy it up as soon as it can reach the internet. Nothing's lost.";

  return (
    <StepFrame>
      <MotiView key={headline} {...enter.rise(0)}>
        <Text className="text-3xl font-serif text-fg leading-tight mb-3">{headline}</Text>
        <Text className="font-sans text-base text-fg-muted leading-relaxed">{body}</Text>
      </MotiView>

      <View className="flex-1 justify-center py-10">
        {stillWorking ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Organizing your note" />
        ) : item ? (
          <MotiView key={structured ? 'structured' : 'raw'} {...enter.rise(1)}>
            <Card variant="raised" pad="lg">
              <Text className="text-fg font-display text-heading leading-tight mb-3">{item.title}</Text>
              {structured && item.nextStep ? (
                <View className="mb-3">
                  <Text className="font-sans-medium text-micro text-fg-tertiary tracking-widest uppercase mb-1">
                    Next step
                  </Text>
                  <Text className="font-sans text-sm text-fg leading-relaxed">{item.nextStep}</Text>
                </View>
              ) : null}
              {structured && item.whereLeftOff ? (
                <View>
                  <Text className="font-sans-medium text-micro text-fg-tertiary tracking-widest uppercase mb-1">
                    Where you left off
                  </Text>
                  <Text className="font-sans text-sm text-fg-secondary leading-relaxed">
                    {item.whereLeftOff}
                  </Text>
                </View>
              ) : null}
              {!structured && item.type !== 'voice' ? (
                <Text className="font-sans text-sm text-fg-secondary leading-relaxed" numberOfLines={4}>
                  {item.content}
                </Text>
              ) : null}
            </Card>
          </MotiView>
        ) : null}
      </View>

      <Button variant="primary" size="lg" fullWidth onPress={onContinue}>
        Continue
      </Button>
    </StepFrame>
  );
}

// ─── Step: nudges ───────────────────────────────────────────────

export function NudgeStep({ itemId, onDone }: { itemId: string | null; onDone: () => void }) {
  const enter = useEnter();
  const colors = useThemeColors();
  const { items } = useMnemoStore();
  const [busy, setBusy] = useState(false);

  // Preview the nudge with their own thought when it has a next step —
  // "this is what you'd get" lands better than a description of it.
  const own = items.find((i) => i.id === itemId);
  const preview =
    own && !own.pending && own.nextStep
      ? { title: own.title, body: `Next step: ${own.nextStep}` }
      : { title: 'Deck intro for Thursday', body: 'Next step: rewrite the opening slide' };

  const choose = async (wantsNudges: boolean) => {
    setBusy(true);
    const granted = wantsNudges ? await requestNudgePermission() : false;
    await saveNudgePrefs({ enabled: granted, time: 'morning' });
    onDone();
  };

  return (
    <StepFrame>
      <MotiView {...enter.rise(0)}>
        <View className="w-12 h-12 rounded-full bg-accent/15 items-center justify-center mb-5">
          <Bell size={22} color={colors.accent} strokeWidth={1.6} />
        </View>
        <Text className="text-3xl font-serif text-fg leading-tight mb-3">
          Want a nudge when{'\n'}a thread goes quiet?
        </Text>
        <Text className="font-sans text-base text-fg-muted leading-relaxed">
          If something sits untouched for a couple of days, Mnemo reminds you once, with its next
          step. Never more than one a day, and you can change it anytime in Settings.
        </Text>
      </MotiView>

      <View className="flex-1 justify-center py-10">
        <MotiView {...enter.rise(1)}>
          <Card variant="surface" pad="md">
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="font-sans-medium text-micro text-fg-tertiary tracking-widest uppercase">
                Mnemo
              </Text>
              <Text className="font-sans text-micro text-fg-tertiary">
                {`${NUDGE_TIMES.morning.hour}:${String(NUDGE_TIMES.morning.minute).padStart(2, '0')}`}
              </Text>
            </View>
            <Text className="font-sans-semi text-sm text-fg mb-0.5" numberOfLines={1}>
              {preview.title}
            </Text>
            <Text className="font-sans text-sm text-fg-secondary" numberOfLines={2}>
              {preview.body}
            </Text>
          </Card>
        </MotiView>
      </View>

      <View className="gap-3">
        <Button variant="primary" size="lg" fullWidth disabled={busy} onPress={() => choose(true)}>
          Turn on nudges
        </Button>
        <Button variant="ghost" size="md" fullWidth disabled={busy} onPress={() => choose(false)}>
          Not now
        </Button>
      </View>
    </StepFrame>
  );
}
