import { useEffect, useState } from 'react';
import { Platform, Switch, View } from 'react-native';
import { CalendarClock } from 'lucide-react-native';

import { Text } from '@/components/ui/Text';
import { Pill } from '@/components/ui/Pill';
import { useThemeColors } from '@/hooks/use-theme';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { DEFAULT_LEADS, LEAD_CHOICES } from '@/lib/leads';
import { calendarAvailable, hasCalendarPermission, requestCalendarPermission } from '@/lib/calendar';
import { haptic } from '@/lib/haptics';

/**
 * Settings → Appointments: the heads-ups before somewhere to be ("dentist
 * tomorrow at 10"), and whether those go into the phone's calendar too.
 * Each thread can still change its own (Remind me, when editing it).
 */
export function AppointmentsCard() {
  const colors = useThemeColors();
  const prefs = usePreferences();
  const leads = prefs.appointmentLeads ?? DEFAULT_LEADS;
  const [granted, setGranted] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    hasCalendarPermission().then(setGranted);
  }, []);

  const toggleCalendar = async (on: boolean) => {
    if (!on) {
      setPreferences({ appointmentsToCalendar: false });
      return;
    }
    const ok = await requestCalendarPermission();
    setGranted(ok);
    setBlocked(!ok);
    if (ok) {
      haptic.select();
      setPreferences({ appointmentsToCalendar: true });
    }
  };

  return (
    <View className="bg-surface rounded-lg p-5 border border-border/50 gap-4">
      <View className="flex-row items-center">
        <CalendarClock size={15} color={colors.accent} strokeWidth={2} />
        <Text className="font-sans-semi text-sm text-fg ml-2">Before an appointment</Text>
      </View>
      <Text className="font-sans text-sm text-fg-secondary">
        When a note names somewhere to be (&ldquo;dentist tomorrow at 10&rdquo;), Mnemo also reminds you ahead of it. A heads-up has an OK button: it puts that one away, and the reminders still to come come all the same.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {LEAD_CHOICES.map((c) => {
          const on = leads.includes(c.lead);
          return (
            <Pill
              key={String(c.lead)}
              tone={colors.accent}
              size="md"
              dot={false}
              outline={!on}
              selected={on}
              onPress={() => {
                const next = on ? leads.filter((l) => l !== c.lead) : [...leads, c.lead];
                setPreferences({ appointmentLeads: next });
              }}
            >
              {c.label}
            </Pill>
          );
        })}
      </View>
      {leads.length === 0 ? (
        <Text className="font-sans text-sm text-fg-tertiary">No heads-ups: only the reminder itself rings.</Text>
      ) : null}

      {calendarAvailable ? (
        <View className="pt-4 border-t border-border/50 gap-2">
          <View className="flex-row items-center justify-between">
            <View className="flex-1 mr-3">
              <Text className="font-sans-semi text-sm text-fg">Add appointments to my calendar</Text>
              <Text className="font-sans text-sm text-fg-secondary mt-0.5">
                Kept in step when the time changes, without alarms of its own, so nothing rings twice.
              </Text>
            </View>
            <Switch
              value={!!prefs.appointmentsToCalendar && granted}
              onValueChange={toggleCalendar}
              accessibilityLabel="Add appointments to my calendar"
              trackColor={{ false: colors.border, true: colors.accent }}
              thumbColor={Platform.OS === 'android' ? colors.surfaceLowest : undefined}
              ios_backgroundColor={colors.border}
            />
          </View>
          {blocked ? (
            <Text className="font-sans text-sm" style={{ color: colors.error }}>
              Mnemo isn&rsquo;t allowed to use your calendar. You can allow it in the phone&rsquo;s settings for Mnemo.
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
