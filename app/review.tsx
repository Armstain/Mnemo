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
import { OpenRing } from '@/components/ui/ThreadRing';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { useReduceMotion } from '@/hooks/use-accessibility-motion';
import { useCountUp } from '@/hooks/use-count-up';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { formatValue } from '@/lib/measures';
import { reviewLine, STILL_ON_IT_DAYS, weekReview, type WeekReview } from '@/lib/review';
import { formatReminder } from '@/lib/when';
import { spanLabel } from '@/lib/wrapup';
import { DUR_BASE, EASE_OUT, useEnter } from '@/utils/motion';

const open = (id: string) => router.push(`/(tabs)/context?id=${id}` as any);
/** Longer lists show this many until "Show all". */
const SHOW = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The weekly review: the last seven days and the next, in one place. What
 * moved, what's due, which steps are open, which threads went quiet (wrap
 * up, keep or pause), and what the numbers came to. All worked out on the
 * phone from the notes.
 */
export default function ReviewScreen() {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const enter = useEnter();
  const { items, entries, completeNextStep, pauseItem, updateItem, restoreItem } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  const r = React.useMemo(() => weekReview(items, entries), [items, entries]);
  const line = reviewLine(r, (t) => `${t.metric} ${formatValue(t.total, t.unit)}`);
  const [all, setAll] = React.useState({ steps: false, quiet: false });
  const empty = items.length === 0;

  let section = 0;
  const steps = all.steps ? r.steps : r.steps.slice(0, SHOW);
  const quiet = all.quiet ? r.quiet : r.quiet.slice(0, SHOW);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) + 32 }}>
        <View className="px-6 flex-row items-center mb-3">
          <IconButton icon="x" label="Close" variant="bare" onPress={() => router.back()} />
        </View>

        <MotiView {...enter.rise(section++)} className="px-6 mb-9">
          <WeekCard r={r} line={line} />
        </MotiView>

        {empty ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Text className="font-sans text-body leading-relaxed" style={{ color: colors.fgSecondary }}>
              Nothing to look back on yet. Notes you add this week show up here, with what's due and anything that goes quiet.
            </Text>
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
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, minWidth: 148 }}
                >
                  <Text className="font-sans-semi text-sm" style={{ color: colors.fgSecondary }}>
                    {t.metric.charAt(0).toUpperCase() + t.metric.slice(1)}
                  </Text>
                  <Text className="font-display mt-0.5" style={{ color: colors.fg, fontSize: 26, fontVariant: ['tabular-nums'] }}>
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

        {/* Reminders: missed, then coming up */}
        {r.due.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>{r.due.some((d) => d.missed) ? 'Missed and coming up' : 'Coming up'}</Eyebrow>
            <ThreadList>
              {r.due.map(({ item, at, missed }, i) => (
                <ThreadRow
                  key={item.id}
                  item={item}
                  index={i}
                  detail={[missed ? 'Missed' : '', item.nextStep ? `Next: ${item.nextStep}` : ''].filter(Boolean).join(' · ') || undefined}
                  trailing={formatReminder(at)}
                  trailingTone={missed ? colors.error : colors.accent}
                  last={i === r.due.length - 1}
                  onPress={() => open(item.id)}
                />
              ))}
            </ThreadList>
          </MotiView>
        ) : null}

        {/* Steps to tick off */}
        {r.steps.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow
              action={r.steps.length > SHOW ? (all.steps ? 'Fewer' : `All ${r.steps.length}`) : undefined}
              onAction={() => setAll((a) => ({ ...a, steps: !a.steps }))}
            >
              Next steps
            </Eyebrow>
            <View className="rounded-lg overflow-hidden" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
              {steps.map((t, i) => (
                <MotiView
                  key={t.id}
                  {...enter.row(i)}
                  className="flex-row items-center pl-4 pr-3 py-3"
                  style={i > 0 ? { borderTopWidth: 1, borderTopColor: colors.border } : undefined}
                >
                  <Pressable onPress={() => open(t.id)} className="flex-1 mr-3 active:opacity-70" accessibilityRole="button">
                    <Text className="font-sans-medium text-body" style={{ color: colors.fg }} numberOfLines={2}>
                      {t.nextStep}
                    </Text>
                    <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      showUndoToast(`Done: ${t.nextStep}`, completeNextStep(t.id));
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark done: ${t.nextStep}`}
                    className="w-10 h-10 rounded-full items-center justify-center active:opacity-60"
                    style={{ backgroundColor: colors.accentSoft }}
                  >
                    <Icon name="check" size={18} stroke={2.2} color={colors.accent} />
                  </Pressable>
                </MotiView>
              ))}
            </View>
          </MotiView>
        ) : null}

        {/* Gone quiet: wrap up, keep going, or pause */}
        {r.quiet.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow
              action={r.quiet.length > SHOW ? (all.quiet ? 'Fewer' : `All ${r.quiet.length}`) : undefined}
              onAction={() => setAll((a) => ({ ...a, quiet: !a.quiet }))}
            >
              Gone quiet
            </Eyebrow>
            <View className="gap-3">
              {quiet.map(({ item, days }, i) => (
                <MotiView
                  key={item.id}
                  {...enter.row(i)}
                  className="rounded-lg p-4"
                  style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
                >
                  <Pressable onPress={() => open(item.id)} accessibilityRole="button" className="flex-row items-start active:opacity-70">
                    <View className="flex-1 mr-3">
                      <Text className="font-sans-semi text-body" style={{ color: colors.fg }} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.nextStep || item.whereLeftOff ? (
                        <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgSecondary }} numberOfLines={2}>
                          {item.nextStep ? `Next: ${item.nextStep}` : item.whereLeftOff}
                        </Text>
                      ) : null}
                    </View>
                    <View className="rounded-full px-2.5 py-1" style={{ backgroundColor: colors.surfaceHigh }}>
                      <Text className="font-sans-semi text-xs" style={{ color: colors.accentWarm, fontVariant: ['tabular-nums'] }}>
                        {days} days
                      </Text>
                    </View>
                  </Pressable>
                  <View className="flex-row flex-wrap gap-2 mt-3.5">
                    <Button variant="tonal" size="sm" icon="check" onPress={() => router.push(`/wrapup?id=${item.id}&from=review` as any)}>
                      Wrap up
                    </Button>
                    <Button
                      variant="quiet"
                      size="sm"
                      onPress={() => {
                        Haptics.selectionAsync();
                        // Not activity: it shouldn't jump to the top of Home.
                        updateItem(item.id, { quietUntil: Date.now() + STILL_ON_IT_DAYS * DAY_MS }, { touch: false });
                        showUndoToast(`Won't ask about it for a month`, () => restoreItem(item));
                      }}
                    >
                      Still on it
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="pause"
                      onPress={() => {
                        Haptics.selectionAsync();
                        pauseItem(item.id);
                        showUndoToast(`Paused ${item.title}`, () => restoreItem(item));
                      }}
                    >
                      Pause
                    </Button>
                  </View>
                </MotiView>
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
                <ThreadRow
                  key={t.id}
                  item={t}
                  index={i}
                  detail="Done"
                  trailing={new Date(t.completedAt ?? t.updatedAt).toLocaleDateString(undefined, { weekday: 'short' })}
                  last={i === r.finished.length - 1}
                  onPress={() => open(t.id)}
                />
              ))}
            </ThreadList>
          </MotiView>
        ) : null}

        <Text className="font-sans text-sm text-center px-10" style={{ color: colors.fgTertiary }}>
          Worked out on your phone, from your notes.
        </Text>
      </ScrollView>
    </View>
  );
}

/** The week at a glance: dates, one line, notes per day, and three counts. */
function WeekCard({ r, line }: { r: WeekReview; line: string }) {
  const colors = useThemeColors();
  const reduceMotion = useReduceMotion();
  const max = Math.max(1, ...r.days.map((d) => d.notes));
  const ticked = r.stepsDone + r.finished.length;
  const dayName = (ts: number) => new Date(ts).toLocaleDateString('en-US', { weekday: 'short' });

  return (
    <View className="rounded-xl overflow-hidden" style={{ backgroundColor: colors.hero, padding: 22 }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: -56, right: -56, opacity: 0.09 }}>
        <OpenRing size={220} color={colors.onHero} core={false} weight={0.11} />
      </View>
      <Eyebrow tone={colors.heroAccent} className="mb-1.5">
        Your week
      </Eyebrow>
      <Text className="font-display leading-tight" style={{ color: colors.onHero, fontSize: 34, letterSpacing: -0.4 }}>
        {spanLabel(r.from, r.to)}
      </Text>
      <Text className="font-quote text-body leading-relaxed mt-1.5" style={{ color: colors.onHeroMuted }}>
        {line}
      </Text>

      {/* Notes per day; today in the accent. */}
      <View
        className="flex-row items-end mt-6"
        style={{ gap: 8, height: 76 }}
        accessible
        accessibilityLabel={`Notes per day: ${r.days.map((d) => `${dayName(d.start)} ${d.notes}`).join(', ')}`}
      >
        {r.days.map((d, i) => {
          const today = i === r.days.length - 1;
          const height = d.notes ? 10 + (d.notes / max) * 46 : 4;
          return (
            <View key={d.start} className="flex-1 items-center justify-end" style={{ height: '100%' }}>
              {d.notes > 0 ? (
                <Text className="font-sans-semi mb-1" style={{ fontSize: 11, color: today ? colors.heroAccent : colors.onHeroMuted, fontVariant: ['tabular-nums'] }}>
                  {d.notes}
                </Text>
              ) : null}
              <MotiView
                from={{ height: 4 }}
                animate={{ height }}
                transition={reduceMotion ? { type: 'timing', duration: 0 } : { type: 'timing', duration: DUR_BASE + 120, delay: 120 + i * 40, easing: EASE_OUT }}
                style={{
                  width: '100%',
                  maxWidth: 30,
                  borderRadius: 6,
                  backgroundColor: today ? colors.heroAccent : d.notes ? colors.onHeroMuted : colors.heroSoft,
                  opacity: today || d.notes === 0 ? 1 : 0.55,
                }}
              />
            </View>
          );
        })}
      </View>
      <View className="flex-row mt-2" style={{ gap: 8 }}>
        {r.days.map((d, i) => (
          <Text
            key={d.start}
            className={`flex-1 text-center text-xs ${i === r.days.length - 1 ? 'font-sans-semi' : 'font-sans'}`}
            style={{ color: i === r.days.length - 1 ? colors.heroAccent : colors.onHeroMuted }}
          >
            {i === r.days.length - 1 ? 'Today' : dayName(d.start).slice(0, 2)}
          </Text>
        ))}
      </View>

      <View className="flex-row mt-5 pt-4" style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft }}>
        <Stat value={r.notes} label={r.notes === 1 ? 'note' : 'notes'} />
        <Stat value={r.threadsTouched} label={r.threadsTouched === 1 ? 'thread' : 'threads'} />
        {/* Only when there's something: a row of zeros reads like a telling-off. */}
        {ticked > 0 ? <Stat value={ticked} label="ticked off" /> : <View className="flex-1" />}
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const colors = useThemeColors();
  const shown = Math.round(useCountUp(value));
  return (
    <View className="flex-1">
      <Text className="font-display" style={{ color: colors.onHero, fontSize: 26, fontVariant: ['tabular-nums'] }}>
        {shown}
      </Text>
      <Text className="font-sans text-sm" style={{ color: colors.onHeroMuted }}>
        {label}
      </Text>
    </View>
  );
}
