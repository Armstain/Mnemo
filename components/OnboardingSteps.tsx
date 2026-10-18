import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
  useWindowDimensions,
  AppState,
} from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { Bell } from 'lucide-react-native';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { RecordButton } from '@/components/ui/RecordButton';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useSpeechCapture } from '@/hooks/use-speech-capture';
import { useThemeColors } from '@/hooks/use-theme';
import { saveApiKey, validateApiKey } from '@/lib/api-key';
import { aiEnabled } from '@/lib/ai-mode';
import { saveTextNote, saveVoiceNote } from '@/lib/capture';
import { cleanName, getPreferences, NAME_MAX, setPreferences } from '@/lib/preferences';
import { NUDGE_TIMES, requestNudgePermission, saveNudgePrefs } from '@/lib/nudges';
import { useEnter } from '@/utils/motion';
import { noFocusRing } from '@/utils/web';

// The steps after onboarding's welcome page: choose how Mnemo thinks (AI
// with your own key, or offline), then make a first real capture, the
// moment the app makes sense. Every step is laid out to fit one screen,
// with no scrolling, down to small phones.

const AI_STUDIO_URL = 'https://aistudio.google.com/app/apikey';

/** How long the reveal waits on AI structuring before saying "saved, tidying later". */
const STRUCTURING_PATIENCE_MS = 15000;

/** Small phones (SE-class): tighter spacing and smaller headlines. */
function useCompact() {
  const { height } = useWindowDimensions();
  return height < 700;
}

function StepFrame({
  onSkip,
  onBack,
  children,
}: {
  onSkip?: () => void;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const compact = useCompact();
  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        className="flex-1"
        style={{
          paddingHorizontal: compact ? 24 : 32,
          paddingTop: insets.top + (compact ? 4 : 12),
          paddingBottom: Math.max(insets.bottom, 16) + (compact ? 12 : 20),
        }}
      >
        <View className="h-11 flex-row justify-between items-center mb-2">
          {onBack ? (
            <Button variant="ghost" size="sm" icon="chevronLeft" onPress={onBack}>
              Back
            </Button>
          ) : (
            <View />
          )}
          {onSkip ? (
            <Button variant="ghost" size="sm" onPress={onSkip}>
              Skip
            </Button>
          ) : null}
        </View>
        {children}
      </View>
    </KeyboardAvoidingView>
  );
}

function Headline({ title, body }: { title: string; body?: string }) {
  const compact = useCompact();
  const colors = useThemeColors();
  return (
    <>
      <Text className="font-display leading-tight mb-2" style={{ color: colors.fg, fontSize: compact ? 26 : 30 }}>
        {title}
      </Text>
      {body ? (
        <Text className="font-sans leading-relaxed" style={{ color: colors.fgSecondary, fontSize: compact ? 14 : 15 }}>
          {body}
        </Text>
      ) : null}
    </>
  );
}

// ─── Step: name ─────────────────────────────────────────────────

export function NameStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const enter = useEnter();
  const colors = useThemeColors();
  const [name, setName] = useState(() => getPreferences().name);

  const save = (value: string) => {
    setPreferences({ name: cleanName(value) });
    onDone();
  };

  return (
    <StepFrame onBack={onBack} onSkip={() => save('')}>
      <MotiView {...enter.rise(0)}>
        <Headline title="What should Mnemo call you?" body="Just for the greeting on Home." />
      </MotiView>
      <MotiView {...enter.rise(1)} className="mt-6">
        <View
          className="flex-row items-center rounded-md px-4 h-14"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            autoFocus
            autoCapitalize="words"
            autoComplete="given-name"
            returnKeyType="done"
            onSubmitEditing={() => save(name)}
            placeholder="Your name"
            placeholderTextColor={colors.fgTertiary}
            accessibilityLabel="Your name"
            selectionColor={colors.accent}
            className="flex-1 font-sans text-heading"
            style={[{ color: colors.fg }, noFocusRing]}
          />
          <Text className="font-sans text-sm ml-2" style={{ color: colors.fgTertiary }}>
            {NAME_MAX - name.length}
          </Text>
        </View>
      </MotiView>
      <View className="flex-1" />
      <Button variant="primary" size="lg" fullWidth disabled={!cleanName(name)} onPress={() => save(name)}>
        Continue
      </Button>
    </StepFrame>
  );
}

// ─── Step: AI or offline ────────────────────────────────────────

function ChoiceCard({
  icon,
  title,
  points,
  recommended,
  onPress,
}: {
  icon: IconName;
  title: string;
  points: string[];
  recommended?: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const compact = useCompact();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${points.join('. ')}`}
      className="rounded-lg active:opacity-80"
      style={{
        backgroundColor: recommended ? colors.accentSoft : colors.surface,
        borderWidth: 1.5,
        borderColor: recommended ? colors.accent : colors.border,
        padding: compact ? 14 : 18,
      }}
    >
      <View className="flex-row items-center mb-2">
        <View
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: recommended ? colors.accent : colors.surfaceHigh }}
        >
          <Icon name={icon} size={18} color={recommended ? colors.accentInk : colors.fg} stroke={2} />
        </View>
        <Text className="flex-1 font-sans-semi text-body ml-3" style={{ color: colors.fg }}>
          {title}
        </Text>
        <Icon name="chevronRight" size={18} color={colors.fgTertiary} />
      </View>
      {points.map((p) => (
        <View key={p} className="flex-row items-start mt-1">
          <Text className="font-sans text-sm mr-2" style={{ color: recommended ? colors.accent : colors.fgTertiary }}>
            •
          </Text>
          <Text className="flex-1 font-sans text-sm leading-snug" style={{ color: colors.fgSecondary }}>
            {p}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

export function AiChoiceStep({
  onGemini,
  onOffline,
  onBack,
}: {
  onGemini: () => void;
  onOffline: () => void;
  onBack: () => void;
}) {
  const enter = useEnter();
  const colors = useThemeColors();
  return (
    <StepFrame onBack={onBack}>
      <MotiView {...enter.rise(0)}>
        <Headline title="How should Mnemo think?" body="You can change this anytime in Settings." />
      </MotiView>
      <View className="flex-1 justify-center gap-3">
        <MotiView {...enter.rise(1)}>
          <ChoiceCard
            icon="sparkles"
            title="Smart, with your free Gemini key"
            recommended
            points={[
              'No account, no server, no bill — the key lives only on this phone',
              'Tidies your notes, finds next steps and numbers',
              'Free from Google, about a minute to set up',
            ]}
            onPress={onGemini}
          />
        </MotiView>
        <MotiView {...enter.rise(2)}>
          <ChoiceCard
            icon="pin"
            title="Offline, on this phone"
            points={[
              'Your notes never leave your phone',
              'Still finds lists, links, amounts and next steps',
              'No key, no account',
            ]}
            onPress={onOffline}
          />
        </MotiView>
      </View>
      <Text className="font-sans text-sm text-center" style={{ color: colors.fgTertiary }}>
        With a key, Gemini writes voice notes out; offline, your phone does. Mnemo never keeps the audio.
      </Text>
    </StepFrame>
  );
}

// ─── Step: Gemini key ───────────────────────────────────────────

/** Loose check: real Gemini keys start with AIza and are ~39 chars. */
function looksLikeGeminiKey(text: string): boolean {
  const t = text.trim();
  return t.startsWith('AIza') && t.length >= 30 && /^[A-Za-z0-9_\-]+$/.test(t);
}

export function KeyStep({ onDone, onOffline, onBack }: { onDone: () => void; onOffline: () => void; onBack: () => void }) {
  const enter = useEnter();
  const colors = useThemeColors();
  const compact = useCompact();
  const [key, setKeyState] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A key copied in AI Studio, spotted when the person comes back to the app.
  const [spottedKey, setSpottedKey] = useState<string | null>(null);
  const keyRef = useRef('');
  const lastSeenClipboard = useRef<string | null>(null);

  const setKeyText = (t: string) => {
    keyRef.current = t;
    setKeyState(t);
  };

  const paste = async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (text) {
        setKeyText(text);
        setError(null);
        Haptics.selectionAsync();
      } else {
        setError('Your clipboard is empty. Copy the key in AI Studio first.');
      }
    } catch {
      setError("Couldn't read the clipboard. Long-press the box to paste.");
    }
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    const result = await validateApiKey(key);
    setChecking(false);
    if (!result.valid) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError(result.error ?? 'That key did not work.');
      return;
    }
    await saveApiKey(key);
    setPreferences({ aiMode: 'gemini' });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onDone();
  };

  // When they return from AI Studio, look for a freshly copied key so they
  // don't have to paste it themselves. Never overwrites what they typed.
  useEffect(() => {
    let cancelled = false;
    const lookForKey = async () => {
      try {
        const text = (await Clipboard.getStringAsync()).trim();
        if (cancelled || text === lastSeenClipboard.current) return;
        lastSeenClipboard.current = text;
        if (text && looksLikeGeminiKey(text) && !keyRef.current.trim()) {
          setSpottedKey(text);
          Haptics.selectionAsync();
        }
      } catch {
        // Clipboard unreadable — the manual paste path still works.
      }
    };
    void lookForKey();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void lookForKey();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const useSpottedKey = () => {
    if (!spottedKey) return;
    setKeyText(spottedKey);
    setSpottedKey(null);
    setError(null);
    Haptics.selectionAsync();
  };

  const stepRow = (n: number, text: string, action?: React.ReactNode) => (
    <View className="flex-row items-center" style={{ minHeight: compact ? 40 : 46 }}>
      <View className="w-7 h-7 rounded-full items-center justify-center mr-3" style={{ backgroundColor: colors.accentSoft }}>
        <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
          {n}
        </Text>
      </View>
      <Text className="flex-1 font-sans text-body" style={{ color: colors.fg }}>
        {text}
      </Text>
      {action}
    </View>
  );

  return (
    <StepFrame onBack={onBack}>
      <MotiView {...enter.rise(0)}>
        <Headline
          title="Your key keeps Mnemo yours"
          body="Mnemo has no account and no server, so the smarts run on a key you own. It's free from Google, takes about a minute, and the key never leaves this phone."
        />
      </MotiView>

      <MotiView {...enter.rise(1)} className="mt-5 gap-1">
        {stepRow(
          1,
          'Open Google AI Studio',
          <Button variant="tonal" size="sm" trailingIcon="arrowUpRight" onPress={() => WebBrowser.openBrowserAsync(AI_STUDIO_URL)}>
            Open
          </Button>,
        )}
        {stepRow(2, 'Create a key (any project name works), then copy it')}
        {stepRow(3, 'Come back here — Mnemo spots it in your clipboard')}
      </MotiView>

      <MotiView {...enter.rise(2)} className="mt-3">
        {spottedKey && !key.trim() ? (
          <View
            className="flex-row items-center rounded-md p-3 mb-2"
            style={{ backgroundColor: colors.accentSoft, borderWidth: 1, borderColor: colors.accent }}
            accessibilityLabel="A Gemini key was found in your clipboard"
          >
            <View className="flex-1 mr-2">
              <Text className="font-sans-semi text-sm" style={{ color: colors.fg }}>
                Key found in your clipboard
              </Text>
              <Text className="font-sans text-xs mt-0.5" style={{ color: colors.fgSecondary }}>
                {spottedKey.slice(0, 10)}…{spottedKey.slice(-4)}
              </Text>
            </View>
            <View className="flex-row items-center" style={{ gap: 4 }}>
              <Button variant="primary" size="sm" onPress={useSpottedKey}>
                Use it
              </Button>
              <Button variant="quiet" size="sm" onPress={() => setSpottedKey(null)}>
                Dismiss
              </Button>
            </View>
          </View>
        ) : null}
        <View
          className="flex-row items-center rounded-md pl-4 pr-1.5 h-12"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: error ? colors.error : colors.border }}
        >
          <TextInput
            value={key}
            onChangeText={(t) => {
              setKeyText(t);
              setError(null);
            }}
            placeholder="AIza…"
            placeholderTextColor={colors.fgTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Gemini API key"
            className="flex-1 font-sans text-body"
            style={[{ color: colors.fg }, noFocusRing]}
          />
          <Button variant="quiet" size="sm" onPress={paste}>
            Paste
          </Button>
        </View>
        {error ? (
          <Text className="font-sans text-sm mt-2" style={{ color: colors.error }}>
            {error}
          </Text>
        ) : (
          <Text className="font-sans text-sm mt-2" style={{ color: colors.fgTertiary }}>
            On a free key, Google may use what you send to improve its products. Your notes stay on this phone.
          </Text>
        )}
      </MotiView>

      <View className="flex-1" />

      <View className="gap-2">
        <Button variant="primary" size="lg" fullWidth disabled={!key.trim() || checking} onPress={check}>
          {checking ? 'Checking…' : 'Check and continue'}
        </Button>
        <Button variant="ghost" size="md" fullWidth onPress={onOffline}>
          Use offline instead
        </Button>
      </View>
    </StepFrame>
  );
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
  const compact = useCompact();
  const store = useMnemoStore();
  const speech = useSpeechCapture();
  const [mode, setMode] = useState<'voice' | 'type'>('voice');
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  // Tap to start, tap to finish (not hold): the first tap is also when the
  // phone asks for the microphone, which would break a hold.
  const toggleListening = async () => {
    if (!speech.listening) {
      setHint(null);
      const result = await speech.start();
      if (result === 'ok') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setHint(
        result === 'permission-denied'
          ? "Mnemo can't use the microphone, so type it instead."
          : "Speech recognition isn't available here, so type it instead.",
      );
      setMode('type');
      return;
    }
    const { words, audio } = await speech.stop();
    if (!words.trim() && audio.length === 0) {
      setHint("Didn't catch that. Tap and try again, or type it.");
      return;
    }
    const saved = saveVoiceNote({ text: words, audio, category: 'general', store });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCaptured(saved.threadId);
  };

  const saveText = () => {
    if (!text.trim()) return;
    const saved = saveTextNote({ text, category: 'general', store });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onCaptured(saved.threadId);
  };

  return (
    <StepFrame
      onSkip={() => {
        speech.cancel();
        onSkip();
      }}
    >
      <MotiView {...enter.rise(0)}>
        <Headline
          title="What's on your mind right now?"
          body="A half-done task, an idea, something to pick up later. Say it the way you'd tell a friend."
        />
      </MotiView>

      {mode === 'voice' ? (
        <>
          <View className="flex-1 items-center justify-center">
            <RecordButton
              size={compact ? 88 : 104}
              recording={speech.listening}
              label={speech.listening ? "Listening · tap when you're done" : 'Tap to start'}
              onPress={toggleListening}
            />
            <Text
              className="font-display text-center mt-5"
              style={{ color: speech.text ? colors.fg : colors.fgTertiary, fontSize: 19, lineHeight: 27 }}
              numberOfLines={compact ? 3 : 4}
              ellipsizeMode="head"
            >
              {speech.listening ? speech.text || 'Listening…' : ' '}
            </Text>
          </View>
          {hint ? <Text className="font-sans text-sm text-fg-secondary text-center mb-3">{hint}</Text> : null}
          <Button
            variant="quiet"
            size="md"
            icon="pencil"
            fullWidth
            onPress={() => {
              speech.cancel();
              setHint(null);
              setMode('type');
            }}
          >
            Prefer typing?
          </Button>
        </>
      ) : (
        // Save sits right under the input so it stays above the keyboard.
        <MotiView {...enter.fade(0)} className="mt-6 gap-3">
          {hint ? <Text className="font-sans text-sm text-fg-secondary">{hint}</Text> : null}
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder="Finish the intro for Thursday's deck, then send it to Sam…"
            placeholderTextColor={colors.fgTertiary}
            accessibilityLabel="Your first thought"
            className="font-sans text-body text-fg bg-surface rounded-lg border border-border/60 p-4"
            style={[{ minHeight: compact ? 104 : 128, textAlignVertical: 'top' }, noFocusRing]}
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
  const ai = aiEnabled();

  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), STRUCTURING_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, []);

  const structured = !!item && !item.pending;
  const stillWorking = !!item?.pending && !waitedOut;

  useEffect(() => {
    if (structured) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [structured]);

  const headline = structured ? "Here's how Mnemo remembers it" : stillWorking ? 'Got it.' : 'Saved.';
  const body = structured
    ? "Next time you open Mnemo, it's waiting on your home screen, one tap from where you left off."
    : stillWorking
      ? 'Turning that into a note…'
      : ai
        ? "Saved as you said it. Mnemo will tidy it up as soon as it can reach Gemini."
        : 'Saved as you said it.';

  return (
    <StepFrame>
      <MotiView key={headline} {...enter.rise(0)}>
        <Headline title={headline} body={body} />
      </MotiView>

      <View className="flex-1 justify-center">
        {stillWorking ? (
          <ActivityIndicator color={colors.accent} accessibilityLabel="Organizing your note" />
        ) : item ? (
          <MotiView key={structured ? 'structured' : 'raw'} {...enter.rise(1)}>
            <Card variant="raised" pad="lg">
              <Text className="text-fg font-display text-heading leading-tight mb-3" numberOfLines={2}>
                {item.title}
              </Text>
              {item.nextStep ? (
                <View className="mb-3">
                  <Text className="font-sans-semi text-xs text-fg-tertiary tracking-caps uppercase mb-1">Next step</Text>
                  <Text className="font-sans text-sm text-fg leading-relaxed">{item.nextStep}</Text>
                </View>
              ) : null}
              {item.whereLeftOff ? (
                <View className="mb-3">
                  <Text className="font-sans-semi text-xs text-fg-tertiary tracking-caps uppercase mb-1">
                    Where you left off
                  </Text>
                  <Text className="font-sans text-sm text-fg-secondary leading-relaxed" numberOfLines={3}>
                    {item.whereLeftOff}
                  </Text>
                </View>
              ) : null}
              {!item.nextStep && !item.whereLeftOff ? (
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

  // Preview the nudge with their own thought when it has a next step.
  const own = items.find((i) => i.id === itemId);
  const preview =
    own && !own.pending && own.nextStep
      ? { title: own.title, body: `Next step: ${own.nextStep}` }
      : { title: 'Deck intro for Thursday', body: 'Next step: rewrite the opening slide' };

  const choose = async (wantsNudges: boolean) => {
    setBusy(true);
    const granted = wantsNudges ? await requestNudgePermission() : false;
    await saveNudgePrefs({ enabled: granted, time: 'morning', weekly: true });
    onDone();
  };

  return (
    <StepFrame>
      <MotiView {...enter.rise(0)}>
        <View className="w-12 h-12 rounded-full bg-accent/15 items-center justify-center mb-4">
          <Bell size={22} color={colors.accent} strokeWidth={1.6} />
        </View>
        <Headline
          title="A nudge when a thread goes quiet?"
          body="If something sits untouched for a couple of days, Mnemo reminds you once, with its next step. Never more than one a day."
        />
      </MotiView>

      <View className="flex-1 justify-center">
        <MotiView {...enter.rise(1)}>
          <Card variant="surface" pad="md">
            <View className="flex-row items-center justify-between mb-1.5">
              <Text className="font-sans-semi text-xs text-fg-tertiary tracking-caps uppercase">Mnemo</Text>
              <Text className="font-sans text-xs text-fg-tertiary">
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

      <View className="gap-2">
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
