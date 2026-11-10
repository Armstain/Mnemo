import { StatusBar } from 'expo-status-bar';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { MotiView } from 'moti';

import { Eyebrow } from '@/components/ui/Eyebrow';
import { Surface } from '@/components/ui/Card';
import { LinkRow } from '@/components/settings/LinkRow';
import { ScreenHeader, useSafeBottom } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useThemeColors, useThemeName } from '@/hooks/use-theme';
import { useProblemReport } from '@/hooks/use-problem-report';
import { useEnter } from '@/hooks/use-enter';

// The explanations Settings used to carry under every switch. Settings keeps the switches;
// this says what they do, so the person can read it once instead of scrolling past it each time.
const TOPICS: { title: string; body: string[] }[] = [
  {
    title: 'Smart',
    body: [
      'Each new note (and any photo on it) goes to Google with your key, with the titles of your recent threads so it can be filed. Smart mode tidies it up, finds numbers and next steps, and files it into the right thread. Notes you wrote offline stay as they are.',
      "If Google's filter declines a note, the phone reads it instead, as offline, so it's never left waiting.",
    ],
  },
  {
    title: 'Offline',
    body: [
      'Your notes never leave your phone. Titles, lists, amounts, next steps and dates are still picked out on the phone, and it suggests a thread when a note shares its words. A link you save is opened by the phone to show its title.',
    ],
  },
  {
    title: 'Voice notes',
    body: [
      "Speak in your own language, or mix them. With Smart mode on, the note is recorded and written out for you, then the recording is deleted. Offline, your phone's speech service writes it out as you talk (on many phones that's Google's, which may work online). Mnemo never keeps the audio.",
    ],
  },
  {
    title: 'Search by meaning',
    body: [
      'Finds "passport" when you search "travel documents". It sends each note to Google a second time, so a free key runs out about twice as fast. Off, search matches your words.',
    ],
  },
  {
    title: 'Nudges and the weekly review',
    body: [
      'When a thread sits untouched for a couple of days, Mnemo reminds you of it once, with its next step. Never more than one a day. The weekly review sums up your week: what is due and what went quiet.',
    ],
  },
  {
    title: 'Place reminders',
    body: [
      'A place is a circle on the map; anywhere inside it counts as being there. Your location stays on your phone.',
      '"When I get to" rings when you cross into the circle. Set it while you are already there and it waits until you leave and come back. "When I leave" works the other way round.',
      'A place reminder rings once, or repeats: every time, on weekdays, at weekends, or on days you pick, at most once a day. The weekend is your region\'s (Friday–Saturday in Bangladesh), and the chip shows the days. Saying "every weekday when I get to the office…" or "every Monday and Thursday…" sets it for you.',
      'To ring with Mnemo closed, the phone needs location "All the time", Google Location Accuracy on, and the battery saver to leave Mnemo alone. Android can be a few minutes late; opening Mnemo catches anything it held back.',
    ],
  },
  {
    title: 'Backups',
    body: [
      'A backup is all your notes in one file, locked with a passphrase. Keep it in Drive, email it to yourself, or import it on a new phone. Without the passphrase nobody can open it, including us.',
      'Daily backup saves one into a folder you choose, when something changed. It keeps the last week, and one from each month before that.',
    ],
  },
  {
    title: 'About Mnemo',
    body: [
      'Named after Mnemosyne, the Greek goddess of memory. Mnemo helps you leave a mental breadcrumb before stepping away from deep work, so you can pick up exactly where you left off.',
    ],
  },
];

export default function HelpScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const bottom = useSafeBottom();
  const colors = useThemeColors();
  const theme = useThemeName();
  const report = useProblemReport();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: 24,
          paddingTop: insets.top + 16,
          paddingBottom: bottom + 48,
        }}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader icon="chevronLeft" label="Back" onClose={() => router.back()} className="mb-4" />

        <MotiView {...enter.rise(0)} className="mb-8">
          <Text className="text-display font-display text-fg">How Mnemo works</Text>
        </MotiView>

        <MotiView {...enter.rise(1)} className="gap-3 mb-10">
          {TOPICS.map((t) => (
            <Surface key={t.title} tone="soft" className="rounded-lg p-5 gap-2">
              <Text className="font-sans-semi text-sm text-fg">{t.title}</Text>
              {t.body.map((p) => (
                <Text key={p} className="font-sans text-sm text-fg-secondary leading-relaxed">
                  {p}
                </Text>
              ))}
            </Surface>
          ))}
        </MotiView>

        <MotiView {...enter.rise(2)} className="gap-3">
          <Eyebrow className="mb-1">Something not working?</Eyebrow>
          <LinkRow
            icon="copy"
            title={report.reportTitle}
            detail="The app version and its recent error messages, to paste into a message. No notes."
            onPress={report.copyReport}
            silent
            chevron={false}
            className="p-5"
          />
          <LinkRow
            icon="trash"
            title={report.clearTitle}
            detail="So the next report starts fresh."
            onPress={report.clearLog}
            silent
            chevron={false}
            className="p-5"
          />
        </MotiView>
      </ScrollView>
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </View>
  );
}
