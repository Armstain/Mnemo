import React from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { OpenRing } from '@/components/ui/ThreadRing';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { formatValue } from '@/lib/measures';
import { headline, spanLabel, wrapText, wrapThread } from '@/lib/wrapup';
import { useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';

/**
 * Wrapping up a thread: one card for what it was (when it ran, how much
 * went into it, what the numbers came to, what's still open), to keep or
 * share, then mark it done.
 */
export default function WrapUpScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const enter = useEnter();
  const categories = useCategories();
  const { getThread, entries, completeItem, restoreItem, getFocusThreadId, setFocusThread } = useMnemoStore();
  const { showToast } = useUndoToast();
  const card = React.useRef<View>(null);
  const thread = getThread(String(id));
  const w = React.useMemo(() => (thread ? wrapThread(thread, entries) : null), [thread, entries]);

  if (!thread || !w) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Math.max(insets.top, 16) }}>
        <View className="px-6">
          <IconButton icon="x" label="Close" variant="bare" onPress={() => router.back()} />
        </View>
        <View className="flex-1 items-center justify-center px-10">
          <Text className="font-sans text-body text-center" style={{ color: colors.fgSecondary }}>
            This thread isn't here any more.
          </Text>
        </View>
      </View>
    );
  }
  const done = thread.status === 'completed';

  const category = categories[thread.category];
  const stats = [
    w.entries > 0 ? [w.entries, w.entries === 1 ? 'note' : 'notes'] : null,
    w.voice > 0 ? [w.voice, 'said aloud'] : null,
    w.photos > 0 ? [w.photos, w.photos === 1 ? 'photo' : 'photos'] : null,
    w.stepsDone > 0 ? [w.stepsDone, w.stepsDone === 1 ? 'step done' : 'steps done'] : null,
  ].filter(Boolean) as [number, string][];

  // An image of the card where the phone can make one; the text otherwise.
  const share = async () => {
    const text = wrapText(thread, w);
    try {
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        const { captureRef } = await import('react-native-view-shot');
        const uri = await captureRef(card, { format: 'png', quality: 1, result: 'tmpfile' });
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: thread.title });
        return;
      }
    } catch {
      // Fall through to sharing the text.
    }
    if (Platform.OS === 'web') {
      try {
        await navigator.clipboard.writeText(text);
        showToast({ message: 'Summary copied' });
      } catch {
        showToast({ message: "Couldn't copy the summary" });
      }
      return;
    }
    await Share.share({ message: text });
  };

  const finish = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const before = thread;
    const wasFocus = getFocusThreadId() === thread.id;
    completeItem(thread.id);
    showToast({
      message: `"${thread.title}" is done`,
      actionLabel: 'Undo',
      onAction: () => {
        restoreItem(before);
        if (wasFocus) setFocusThread(before.id);
      },
    });
    // Back to the review it came from; otherwise Home, since the thread is finished.
    if (from === 'review') router.back();
    else router.dismissTo('/' as any);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) + 24 }}>
        <View className="px-6 flex-row items-center justify-between mb-4">
          <IconButton icon="x" label="Close" variant="bare" onPress={() => router.back()} />
          <Text className="font-sans-medium text-sm" style={{ color: colors.fgSecondary }}>
            {done ? 'Finished' : 'Wrap up'}
          </Text>
          <View style={{ width: 44 }} />
        </View>

        {/* The card: what this thread was, at a glance. */}
        <MotiView {...enter.rise(0)} className="px-3">
          {/* Captured for sharing: the page colour around the card keeps its corners from going black. */}
          <View ref={card} collapsable={false} style={{ backgroundColor: colors.bg, padding: 12 }}>
            <View className="rounded-xl overflow-hidden" style={{ backgroundColor: colors.hero, padding: 24 }}>
              <View pointerEvents="none" style={{ position: 'absolute', top: -40, right: -40, opacity: 0.1 }}>
                <OpenRing size={220} color={colors.onHero} core={false} weight={0.11} />
              </View>
              <Text className="font-sans-semi text-sm" style={{ color: colors.heroAccent }}>
                {category.label} · {spanLabel(w.from, w.to)} · {w.days} {w.days === 1 ? 'day' : 'days'}
              </Text>
              <Text className="font-display leading-tight mt-2" style={{ color: colors.onHero, fontSize: 32, letterSpacing: -0.4 }}>
                {thread.title}
              </Text>
  
              {stats.length > 0 ? (
                <View className="flex-row flex-wrap mt-5" style={{ gap: 20 }}>
                  {stats.map(([n, label]) => (
                    <View key={label}>
                      <Text className="font-display" style={{ color: colors.onHero, fontSize: 24, fontVariant: ['tabular-nums'] }}>
                        {n}
                      </Text>
                      <Text className="font-sans text-sm" style={{ color: colors.onHeroMuted }}>
                        {label}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
  
              {w.numbers.slice(0, 3).map((s) => (
                <View key={s.key} className="mt-5 pt-4" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft }}>
                  <View className="flex-row items-baseline justify-between">
                    <Text className="font-sans-semi text-sm" style={{ color: colors.onHeroMuted }}>
                      {s.metric.charAt(0).toUpperCase() + s.metric.slice(1)}
                    </Text>
                    <Text className="font-display" style={{ color: colors.onHero, fontSize: 26, fontVariant: ['tabular-nums'] }}>
                      {headline(s)}
                    </Text>
                  </View>
                  {s.byGroup?.slice(0, 4).map((g) => (
                    <View key={g.group} className="flex-row justify-between mt-1.5">
                      <Text className="font-sans text-sm" style={{ color: colors.onHeroMuted }}>
                        {g.group.charAt(0).toUpperCase() + g.group.slice(1)}
                      </Text>
                      <Text className="font-sans-medium text-sm" style={{ color: colors.onHero, fontVariant: ['tabular-nums'] }}>
                        {formatValue(g.total, s.unit)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
  
              {w.openSteps.length > 0 ? (
                <View className="mt-5 pt-4" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft }}>
                  <Text className="font-sans-semi text-sm mb-1" style={{ color: colors.onHeroMuted }}>
                    Still open
                  </Text>
                  {w.openSteps.slice(0, 3).map((step) => (
                    <Text key={step} className="font-sans text-body mt-0.5" style={{ color: colors.onHero }} numberOfLines={2}>
                      {step}
                    </Text>
                  ))}
                  {w.openSteps.length > 3 ? (
                    <Text className="font-sans text-sm mt-1" style={{ color: colors.onHeroMuted }}>
                      and {w.openSteps.length - 3} more
                    </Text>
                  ) : null}
                </View>
              ) : null}
  
              <View className="flex-row items-center mt-6" style={{ gap: 6, opacity: 0.7 }}>
                <OpenRing size={14} color={colors.heroAccent} weight={0.18} />
                <Text className="font-sans-medium text-sm" style={{ color: colors.onHeroMuted }}>
                  Kept with Mnemo
                </Text>
              </View>
            </View>
          </View>
        </MotiView>

        <MotiView {...enter.rise(1)} className="px-6 mt-4 gap-3">
          {done ? (
            <>
              <Button variant="primary" size="lg" icon="share" fullWidth onPress={share}>
                Share card
              </Button>
              <Button variant="ghost" size="md" fullWidth onPress={() => router.back()}>
                Close
              </Button>
            </>
          ) : (
            <>
              {w.openSteps.length > 0 ? (
                <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                  Open steps stay in the thread. You can reopen it any time from the Library.
                </Text>
              ) : null}
              <Button variant="primary" size="lg" icon="check" fullWidth onPress={finish}>
                Mark as done
              </Button>
              <View className="flex-row gap-3">
                <Button variant="quiet" size="md" icon="share" className="flex-1" onPress={share}>
                  Share card
                </Button>
                <Button variant="ghost" size="md" className="flex-1" onPress={() => router.back()}>
                  Keep it open
                </Button>
              </View>
            </>
          )}
        </MotiView>
      </ScrollView>
    </View>
  );
}
