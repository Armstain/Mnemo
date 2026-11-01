import React from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { placeHealth, placeProblems, type PlaceProblem } from '@/lib/geofence';

/** What's stopping place reminders, rechecked whenever `when` changes (focus, app return). */
export function usePlaceProblems(when: unknown = 0): PlaceProblem[] | null {
  const [problems, setProblems] = React.useState<PlaceProblem[] | null>(null);
  React.useEffect(() => {
    let live = true;
    placeHealth().then((h) => live && setProblems(placeProblems(h)));
    return () => {
      live = false;
    };
  }, [when]);
  return problems;
}

/**
 * Warnings in a short list: a sign, the sentence, and the button that fixes
 * it when there is one. Used under a place, a reminder, and in Settings.
 */
export function WarningList({ lines, tone }: { lines: { text: string; action?: string; fix?: () => void }[]; tone?: string }) {
  const colors = useThemeColors();
  const color = tone ?? colors.accentWarm;
  if (lines.length === 0) return null;
  return (
    <View className="gap-2">
      {lines.map((l) => (
        <View key={l.text} className="flex-row items-start" style={{ gap: 8 }}>
          <View style={{ marginTop: 2 }}>
            <Icon name="alert" size={15} color={color} stroke={2} />
          </View>
          <Text className="flex-1 font-sans text-sm leading-snug" style={{ color: colors.fgSecondary }}>
            {l.text}
          </Text>
          {l.action && l.fix ? (
            <Pressable onPress={l.fix} accessibilityRole="button" hitSlop={8} className="active:opacity-70">
              <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
                {l.action}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}
