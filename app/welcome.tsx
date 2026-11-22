import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';

import { Button } from '@/components/ui/Button';
import { useSurfaceStyle } from '@/components/ui/Card';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { HeroCard } from '@/components/ui/HeroCard';
import { Icon } from '@/components/ui/Icon';
import { ScreenHeader, useSafeBottom, useSafeTop } from '@/components/ui/Screen';
import { StepList } from '@/components/ui/StepList';
import { Text } from '@/components/ui/Text';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { useShowMore } from '@/hooks/use-show-more';
import { swapToThread } from '@/lib/navigation';
import { useAwaySince } from '@/hooks/use-away';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useStepDone } from '@/hooks/use-complete-thread';
import { useThemeColors } from '@/hooks/use-theme';
import { awayDigest, awayFor, leftOn, shortWhen, type AwayRow } from '@/lib/away';
import { resumeOrder } from '@/lib/when';
import { capitalize, sameWords } from '@/utils/text';
import { formatCompactDistance } from '@/utils/time';
import { useEnter } from '@/hooks/use-enter';
import type { MnemoItem } from '@/types/mnemo';


/**
 * Welcome back: the whole picture after days away, on one page. How long
 * it's been, the one thread to start with, then everything that's waiting:
 * reminders that passed, what's due in the next few days, next steps (tick
 * them off right here), where each quiet project was left, and the ideas
 * kept for later. Opens by itself once per return (Home), and from Home's
 * "While you were away" any time until "Got it". Worked out on the phone.
 */
export default function WelcomeScreen() {
  const top = useSafeTop();
  const bottom = useSafeBottom(16);
  const surface = useSurfaceStyle();
  const colors = useThemeColors();
  const enter = useEnter();
  const { items, entries, getActiveItems, focusThreadId } = useMnemoStore();
  // A step's check: ticks it, or finishes a thread that is one thing to do (lib/done.ts finishModel).
  const stepDone = useStepDone();
  const { since, dismiss } = useAwaySince();
  const more = useShowMore();

  // The same first pick as Home's Resume card, so the two agree.
  const first = resumeOrder(getActiveItems(), { focusId: focusThreadId })[0] as MnemoItem | undefined;
  const d = since !== null ? awayDigest(items, entries, since, Date.now(), first?.id) : null;

  const gotIt = () => {
    dismiss();
    router.back();
  };

  if (!d) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: top }} className="px-6">
        <ScreenHeader onClose={() => router.back()} className="mb-0" />
        <Text className="font-display text-title mt-6" style={{ color: colors.fg }}>
          You're all caught up
        </Text>
        <Text className="font-sans text-body leading-relaxed mt-2" style={{ color: colors.fgSecondary }}>
          When you've been away a few days, this page shows what came and went and what's still waiting.
        </Text>
      </View>
    );
  }

  const g = d.groups;
  const steps = more.shown('steps', g.steps);
  const leftOff = more.shown('leftOff', g.leftOff);
  const ideas = more.shown('ideas', g.ideas);
  const nothing = d.total === 0 && g.ideas.length === 0 && !first;
  let section = 0;

  const firstStep = first?.nextStep && !sameWords(first.nextStep, first.title) ? first.nextStep : undefined;
  const firstLeftOff = first?.whereLeftOff && !sameWords(first.whereLeftOff, first.title) ? first.whereLeftOff : undefined;

  const rowsOf = (rows: AwayRow[], trailing: (r: AwayRow) => { label: string; tone?: string }) => (
    <ThreadList>
      {rows.map((r, i) => {
        const t = trailing(r);
        return (
          <ThreadRow
            key={r.item.id}
            item={r.item}
            index={i}
            detail={r.text !== r.item.title ? r.text : undefined}
            trailing={t.label}
            trailingTone={t.tone}
            last={i === rows.length - 1}
            onPress={() => swapToThread(r.item.id)}
          />
        );
      })}
    </ThreadList>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: top, paddingBottom: 120 + bottom }}>
        <ScreenHeader onClose={() => router.back()} />

        <MotiView {...enter.rise(section++)} className="px-6 mb-9">
          <HeroCard>
            <Eyebrow tone={colors.heroAccent} className="mb-1.5">
              Welcome back
            </Eyebrow>
            <Text className="font-display leading-tight" style={{ color: colors.onHero, fontSize: 34, letterSpacing: -0.4 }}>
              {capitalize(awayFor(d.days))} away
            </Text>
            <Text className="font-sans text-sm mt-1" style={{ color: colors.onHeroMuted }}>
              Since {leftOn(d.since)}
              {d.added > 0 ? ` · ${d.added} ${d.added === 1 ? 'note' : 'notes'} came in` : ''}
            </Text>
            <Text className="font-quote text-body leading-relaxed mt-3" style={{ color: colors.onHero }}>
              {d.line}
            </Text>

            {first ? (
              <Pressable
                onPress={() => swapToThread(first.id)}
                accessibilityRole="button"
                accessibilityLabel={`Start with ${first.title}`}
                className="mt-5 pt-4 flex-row items-center active:opacity-80"
                style={{ borderTopWidth: 1, borderTopColor: colors.heroSoft, gap: 12 }}
              >
                <View className="flex-1" style={{ minWidth: 0 }}>
                  <Text className="font-sans-semi text-xs uppercase tracking-caps mb-1" style={{ color: colors.heroAccent }}>
                    Start with
                  </Text>
                  <Text className="font-display text-title leading-tight" style={{ color: colors.onHero }} numberOfLines={2}>
                    {first.title}
                  </Text>
                  {firstStep ? (
                    <Text className="font-sans-medium text-body leading-snug mt-1" style={{ color: colors.onHero }} numberOfLines={2}>
                      {firstStep}
                    </Text>
                  ) : firstLeftOff ? (
                    <Text className="font-quote text-body leading-snug mt-1" style={{ color: colors.onHeroMuted }} numberOfLines={2}>
                      “{firstLeftOff}”
                    </Text>
                  ) : null}
                </View>
                <View className="w-12 h-12 rounded-full items-center justify-center" style={{ backgroundColor: colors.onHero }}>
                  <Icon name="play" size={18} stroke={2.2} color={colors.hero} />
                </View>
              </Pressable>
            ) : null}
          </HeroCard>
        </MotiView>

        {nothing ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Text className="font-sans text-body leading-relaxed" style={{ color: colors.fgSecondary }}>
              Nothing waiting. Capture what's on your mind and it'll be here next time.
            </Text>
          </MotiView>
        ) : null}

        {g.missed.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Passed while you were away</Eyebrow>
            {rowsOf(g.missed, (r) => ({ label: r.reason.kind === 'missed' ? shortWhen(r.reason.at) : '', tone: colors.error }))}
          </MotiView>
        ) : null}

        {g.due.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow>Coming up</Eyebrow>
            {rowsOf(g.due, (r) => ({ label: r.reason.kind === 'due' ? shortWhen(r.reason.at) : '', tone: colors.accent }))}
          </MotiView>
        ) : null}

        {/* Next steps, ticked off right here. */}
        {g.steps.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow {...more.eyebrow('steps', g.steps.length)}>Still to do</Eyebrow>
            <StepList
              steps={steps.map((r) => ({ id: r.item.id, text: r.text, title: r.item.title }))}
              onOpen={swapToThread}
              onDone={stepDone}
            />
          </MotiView>
        ) : null}

        {g.leftOff.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow {...more.eyebrow('leftOff', g.leftOff.length)}>Where you left off</Eyebrow>
            <View className="gap-3">
              {leftOff.map((r, i) => (
                <MotiView key={r.item.id} {...enter.row(i)}>
                  <Pressable
                    onPress={() => swapToThread(r.item.id)}
                    accessibilityRole="button"
                    className="rounded-lg p-4 active:opacity-80"
                    style={surface}
                  >
                    <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
                      <Text className="font-sans-semi text-body shrink" style={{ color: colors.fg }} numberOfLines={1}>
                        {r.item.title}
                      </Text>
                      <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                        {formatCompactDistance(r.item.updatedAt)}
                      </Text>
                    </View>
                    <Text className="font-quote text-body leading-relaxed mt-1.5" style={{ color: colors.fgSecondary }}>
                      “{r.text}”
                    </Text>
                  </Pressable>
                </MotiView>
              ))}
            </View>
          </MotiView>
        ) : null}

        {g.ideas.length > 0 ? (
          <MotiView {...enter.rise(section++)} className="px-6 mb-9">
            <Eyebrow {...more.eyebrow('ideas', g.ideas.length)}>Ideas kept for later</Eyebrow>
            <ThreadList>
              {ideas.map((item, i) => (
                <ThreadRow key={item.id} item={item} index={i} last={i === ideas.length - 1} onPress={() => swapToThread(item.id)} />
              ))}
            </ThreadList>
          </MotiView>
        ) : null}
      </ScrollView>

      <View
        className="absolute left-0 right-0 bottom-0 px-6 pt-3"
        style={{ backgroundColor: colors.bg, paddingBottom: bottom, borderTopWidth: 1, borderTopColor: colors.border }}
      >
        <Button variant="primary" size="lg" icon="check" onPress={gotIt}>
          Got it
        </Button>
      </View>
    </View>
  );
}
