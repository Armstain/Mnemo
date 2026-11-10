import React from 'react';
import { Platform, ScrollView, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import * as Sharing from 'expo-sharing';

import { Button } from '@/components/ui/Button';
import { HeroCard } from '@/components/ui/HeroCard';
import { ScreenHeader, useSafeBottom, useSafeTop } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { OpenRing } from '@/components/ui/ThreadRing';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { formatValue } from '@/lib/measures';
import { headline, spanLabel, wrapText, wrapThread } from '@/lib/wrapup';
import { useCompleteThread } from '@/hooks/use-complete-thread';
import { useCategories } from '@/hooks/use-categories';
import { useEnter } from '@/hooks/use-enter';
import { capitalize } from '@/utils/text';

/**
 * Wrapping up a thread: one card for what it was (when it ran, how much
 * went into it, what the numbers came to, what's still open), to keep or
 * share, then mark it done.
 */
export default function WrapUpScreen() {
  const { id, from } = useLocalSearchParams<{ id: string; from?: string }>();
  const top = useSafeTop();
  const bottom = useSafeBottom();
  const colors = useThemeColors();
  const enter = useEnter();
  const categories = useCategories();
  const { getThread, entries } = useMnemoStore();
  const completeThread = useCompleteThread();
  const { showToast } = useUndoToast();
  const card = React.useRef<View>(null);
  const thread = getThread(String(id));
  const w = React.useMemo(() => (thread ? wrapThread(thread, entries) : null), [thread, entries]);

  if (!thread || !w) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: top }}>
        <ScreenHeader onClose={() => router.back()} className="px-6 mb-0" />
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
    // The same completion as the thread's Done (state once, one feedback, one Undo).
    if (!completeThread(thread.id)) return;
    // Back to the review it came from; otherwise Home, since the thread is finished.
    if (from === 'review') router.back();
    else router.dismissTo('/');
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingBottom: bottom + 24 }}>
        <ScreenHeader
          onClose={() => router.back()}
          title={done ? 'Finished' : 'Wrap up'}
          trailing={<View style={{ width: 44 }} />}
          className="px-6 mb-4"
        />

        <MotiView {...enter.rise(0)} className="px-3">
          {/* Captured for sharing: the page colour around the card keeps its corners from going black. */}
          <View ref={card} collapsable={false} style={{ backgroundColor: colors.bg, padding: 12 }}>
            <HeroCard padding={24} ringOffset={-40} ringOpacity={0.1}>
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
                      {capitalize(s.metric)}
                    </Text>
                    <Text className="font-display" style={{ color: colors.onHero, fontSize: 26, fontVariant: ['tabular-nums'] }}>
                      {headline(s)}
                    </Text>
                  </View>
                  {s.byGroup?.slice(0, 4).map((g) => (
                    <View key={g.group} className="flex-row justify-between mt-1.5">
                      <Text className="font-sans text-sm" style={{ color: colors.onHeroMuted }}>
                        {capitalize(g.group)}
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
            </HeroCard>
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
              <Button variant="primary" size="lg" icon="check" fullWidth haptic={false} onPress={finish}>
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
