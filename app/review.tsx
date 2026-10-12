import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, IconButton } from '@/components/ui/Button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { formatValue } from '@/lib/measures';
import { reviewLine, weekReview } from '@/lib/review';
import { formatReminder } from '@/lib/when';
import { spanLabel } from '@/lib/wrapup';
import { useEnter } from '@/utils/motion';

const open = (id: string) => router.push(`/(tabs)/context?id=${id}` as any);

/**
 * The weekly review: the last seven days and the next, in one place. What
 * moved, what's due, which steps are open, which threads went quiet (keep,
 * pause or wrap up), and what the numbers came to. All worked out on the
 * phone from the notes.
 */
export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const enter = useEnter();
  const { items, entries, completeNextStep, pauseItem } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  const r = React.useMemo(() => weekReview(items, entries), [items, entries]);
  const line = reviewLine(r, (t) => `${t.metric} ${formatValue(t.total, t.unit)}`);
  const nothing = r.notes === 0 && r.due.length + r.steps.length + r.quiet.length + r.finished.length === 0;

  let section = 0;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) + 32 }}>
        <View className="px-6 flex-row items-center justify-between mb-2">
          <IconButton icon="x" label="Close" variant="bare" onPress={() => router.back()} />
        </View>

        <MotiView {...enter.rise(section++)} className="px-6 mb-8">
          <Eyebrow>Your week</Eyebrow>
          <Text className="font-display text-fg leading-tight" style={{ fontSize: 34, letterSpacing: -0.4 }}>
            {spanLabel(r.from, r.to)}
          </Text>
          <Text className="font-quote text-body leading-relaxed mt-1.5" style={{ color: colors.fgSecondary }}>
            {line}
          </Text>
        </MotiView>

        {nothing ? (
          <MotiView {...enter.rise(section++)} className="px-6">
            <View className="rounded-lg p-5" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              <Text className="font-sans text-body" style={{ color: colors.fgSecondary }}>
                Nothing to look back on yet. Notes you add this week will show up here, with what's due and what went quiet.
              </Text>
            </View>
          </MotiView>
        ) : null}

        {/* What the numbers came to */}
        {r.totals.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="mb-9">
            <View className="px-6">
              <Eyebrow>Added up this week</Eyebrow>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 10 }}>
              {r.totals.map((t) => (
                <View
                  key={`${t.metric}|${t.unit}`}
                  className="rounded-lg px-4 py-3.5"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 140 }}
                >
                  <Text className="font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
                    {t.metric.charAt(0).toUpperCase() + t.metric.slice(1)}
                  </Text>
                  <Text className="font-display mt-0.5" style={{ color: colors.fg, fontSize: 24, fontVariant: ['tabular-nums'] }}>
                    {formatValue(t.total, t.unit)}
                  </Text>
                  <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                    {t.count} {t.count === 1 ? 'entry' : 'entries'}
                    {t.threads > 1 ? ` · ${t.threads} threads` : ''}
                  </Text>
                </View>
              ))}
            </ScrollView>
          </MotiView>
        ) : null}

        {/* Due this week (or missed) */}
        {r.due.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Coming up</Eyebrow>
            <ThreadList>
              {r.due.map((t, i) => (
                <ThreadRow
                  key={t.id}
                  item={t}
                  index={i}
                  detail={t.nextStep ? `Next: ${t.nextStep}` : undefined}
                  trailing={formatReminder(t.dueDate!)}
                  trailingTone={t.dueDate! < Date.now() ? colors.error : colors.accent}
                  last={i === r.due.length - 1}
                  onPress={() => open(t.id)}
                />
              ))}
            </ThreadList>
          </MotiView>
        ) : null}

        {/* Steps to tick off */}
        {r.steps.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Next steps</Eyebrow>
            <View className="rounded-lg overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              {r.steps.map((t, i) => (
                <View
                  key={t.id}
                  className="flex-row items-center px-4 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Pressable onPress={() => open(t.id)} className="flex-1 mr-3 active:opacity-70" accessibilityRole="button">
                    <Text className="font-sans-medium text-body" style={{ color: colors.fg }}>
                      {t.nextStep}
                    </Text>
                    <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      const step = t.nextStep;
                      showUndoToast(`Done: ${step}`, completeNextStep(t.id));
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark done: ${t.nextStep}`}
                    className="w-10 h-10 rounded-full items-center justify-center active:opacity-60"
                    style={{ backgroundColor: colors.accentSoft }}
                  >
                    <Icon name="check" size={18} stroke={2.2} color={colors.accent} />
                  </Pressable>
                </View>
              ))}
            </View>
          </MotiView>
        ) : null}

        {/* Gone quiet: keep, pause or wrap up */}
        {r.quiet.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Gone quiet</Eyebrow>
            <View className="gap-3">
              {r.quiet.map(({ item, days }) => (
                <View
                  key={item.id}
                  className="rounded-lg px-4 py-3.5"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                >
                  <Pressable onPress={() => open(item.id)} accessibilityRole="button" className="active:opacity-70">
                    <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                      {item.title}
                    </Text>
                    <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }}>
                      Nothing new for {days} days{item.nextStep ? ` · Next: ${item.nextStep}` : ''}
                    </Text>
                  </Pressable>
                  <View className="flex-row gap-2 mt-3">
                    <Button variant="tonal" size="sm" icon="check" onPress={() => router.push(`/wrapup?id=${item.id}` as any)}>
                      Wrap up
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      icon="pause"
                      onPress={() => {
                        pauseItem(item.id);
                        Haptics.selectionAsync();
                      }}
                    >
                      Pause
                    </Button>
                    <Button variant="ghost" size="sm" onPress={() => open(item.id)}>
                      Open
                    </Button>
                  </View>
                </View>
              ))}
            </View>
          </MotiView>
        ) : null}

        {/* Finished */}
        {r.finished.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Finished this week</Eyebrow>
            <ThreadList>
              {r.finished.map((t, i) => (
                <ThreadRow key={t.id} item={t} index={i} last={i === r.finished.length - 1} onPress={() => open(t.id)} />
              ))}
            </ThreadList>
          </MotiView>
        ) : null}
      </ScrollView>
    </View>
  );
}
