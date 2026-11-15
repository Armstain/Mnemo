import React, { useState } from 'react';
import { View, Pressable, Platform } from 'react-native';
import { haptic } from '@/utils/haptics';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

import { Text } from '@/components/ui/Text';
import { useThemeColors } from '@/hooks/use-theme';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { formatReminder, quickTimes, repeatLabel, type Repeat } from '@/lib/when';
import { nthOf, nthOfMonth } from '@/lib/repeat';
import { LEAD_CHOICES, type Lead } from '@/lib/leads';
import { calendarAvailable } from '@/lib/calendar';

interface DueDatePickerProps {
  value?: number; // timestamp
  onChange: (timestamp: number | undefined) => void;
  /** Offer "every day / weekday / week / other week / month / year" once a time is set. */
  repeat?: Repeat;
  onRepeatChange?: (repeat: Repeat | undefined) => void;
  /** Heads-ups before a one-off reminder ("a day before", "an hour before"). */
  leads?: Lead[];
  onLeadsChange?: (leads: Lead[] | undefined) => void;
  /** Also an event in the phone's calendar. */
  inCalendar?: boolean;
  onCalendarChange?: (on: boolean) => void;
}

/** "Due tomorrow, 9:00 AM" / "Overdue · Yesterday, 5:00 PM". */
export function formatDueDate(timestamp: number): string {
  const when = formatReminder(timestamp);
  return timestamp < Date.now() ? `Overdue · ${when}` : `Due ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
}

/** The repeats offered for a reminder at `value`: the month one follows its weekday ("the last Friday"), and one read from a note stays offered. */
function repeatChoices(value: number, current?: Repeat): (Repeat | undefined)[] {
  const { nth, last } = nthOf(new Date(value));
  const choices: (Repeat | undefined)[] = [undefined, 'daily', 'weekdays', 'weekly', 'every-2-weeks', 'monthly', nthOfMonth(last ? -1 : nth), 'yearly'];
  return current && !choices.includes(current) ? [...choices, current] : choices;
}

function Chip({
  label,
  selected,
  onPress,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: 'clock' | 'repeat' | 'calendar' | 'bell';
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={() => {
        haptic.select();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      className="flex-row items-center rounded-full px-3.5 h-9 active:opacity-70"
      style={{
        backgroundColor: selected ? colors.accentSoft : colors.surface,
        borderWidth: 1,
        borderColor: selected ? `${colors.accent}40` : colors.border,
      }}
    >
      {icon ? <Icon name={icon} size={13} color={selected ? colors.accent : colors.fgTertiary} /> : null}
      <Text
        className={`font-sans-medium text-sm ${icon ? 'ml-1.5' : ''}`}
        style={{ color: selected ? colors.accent : colors.fgSecondary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** The web has no native picker: the browser's own date-and-time field. */
function WebDateTime({ value, onPick }: { value?: number; onPick: (ts: number) => void }) {
  const colors = useThemeColors();
  const local = value
    ? new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    : '';
  return React.createElement('input', {
    type: 'datetime-local',
    defaultValue: local,
    'aria-label': 'Pick a day and time',
    onChange: (e: { target: { value: string } }) => {
      const ts = new Date(e.target.value).getTime();
      if (Number.isFinite(ts)) onPick(ts);
    },
    style: {
      font: 'inherit',
      fontSize: 14,
      color: colors.fg,
      background: colors.surface,
      border: `1px solid ${colors.border}`,
      borderRadius: 12,
      padding: '8px 12px',
    },
  });
}

/**
 * When to be reminded: quick choices ("Tomorrow morning"), any day and time,
 * and whether it comes back every day, week or month.
 */
export function DueDatePicker({ value, onChange, repeat, onRepeatChange, leads, onLeadsChange, inCalendar, onCalendarChange }: DueDatePickerProps) {
  const colors = useThemeColors();
  // Native picking is two steps on Android (a day, then a time).
  const [step, setStep] = useState<'closed' | 'date' | 'time'>('closed');
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const [custom, setCustom] = useState(false);
  const quick = quickTimes();
  const isOverdue = value ? value < Date.now() && !repeat : false;

  const onNative = (event: DateTimePickerEvent, selected?: Date) => {
    if (event.type !== 'set' || !selected) {
      setStep('closed');
      return;
    }
    if (Platform.OS === 'android' && step === 'date') {
      setPickedDay(selected);
      setStep('time');
      return;
    }
    const d = new Date(pickedDay ?? selected);
    d.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    onChange(d.getTime());
    setStep('closed');
    setPickedDay(null);
  };

  const startValue = value ? new Date(value) : (() => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    return d;
  })();

  return (
    <View className="gap-3">
      {value ? (
        <View className="flex-row items-center gap-2">
          <View
            className="flex-row items-center rounded-full px-4 h-10"
            style={{
              backgroundColor: isOverdue ? `${colors.error}24` : colors.accentSoft,
              borderWidth: 1,
              borderColor: isOverdue ? `${colors.error}59` : `${colors.accent}40`,
            }}
          >
            <Icon name={repeat ? 'repeat' : 'clock'} size={14} color={isOverdue ? colors.error : colors.accent} />
            <Text className="font-sans-medium text-sm ml-2" style={{ color: isOverdue ? colors.error : colors.accent }}>
              {formatReminder(value)}
              {repeat ? ` · ${repeatLabel(repeat, value).toLowerCase()}` : ''}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              onChange(undefined);
              onRepeatChange?.(undefined);
            }}
            accessibilityRole="button"
            accessibilityLabel="Remove reminder"
            className="w-9 h-9 rounded-full items-center justify-center active:opacity-60"
            style={{ backgroundColor: colors.surfaceHigh }}
          >
            <Icon name="x" size={14} color={colors.fgTertiary} />
          </Pressable>
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        {quick.map((q) => (
          <Chip key={q.key} label={q.label} selected={value === q.at} onPress={() => onChange(q.at)} />
        ))}
        <Chip
          label="Pick a time…"
          icon="calendar"
          selected={custom}
          onPress={() => (Platform.OS === 'web' ? setCustom((v) => !v) : setStep('date'))}
        />
      </View>

      {Platform.OS === 'web' && custom ? <WebDateTime value={value} onPick={onChange} /> : null}

      {value && onRepeatChange ? (
        <View className="flex-row flex-wrap gap-2">
          {repeatChoices(value, repeat).map((r) => (
            <Chip
              key={r ?? 'once'}
              label={r ? repeatLabel(r, value) : 'Once'}
              icon={r ? 'repeat' : undefined}
              selected={repeat === r}
              onPress={() => onRepeatChange(r)}
            />
          ))}
        </View>
      ) : null}

      {value && !repeat && onLeadsChange ? (
        <View className="gap-2">
          <Text className="font-sans text-xs text-fg-tertiary">Heads-up before (for an appointment)</Text>
          <View className="flex-row flex-wrap gap-2">
            {LEAD_CHOICES.map((c) => {
              const on = !!leads?.includes(c.lead);
              return (
                <Chip
                  key={String(c.lead)}
                  label={c.short}
                  icon={on ? 'bell' : undefined}
                  selected={on}
                  onPress={() => {
                    const next = on ? (leads ?? []).filter((l) => l !== c.lead) : [...(leads ?? []), c.lead];
                    onLeadsChange(next.length > 0 ? next : undefined);
                  }}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      {value && onCalendarChange && calendarAvailable ? (
        <View className="flex-row flex-wrap gap-2">
          <Chip label={inCalendar ? 'In your calendar' : 'Add to calendar'} icon="calendar" selected={!!inCalendar} onPress={() => onCalendarChange(!inCalendar)} />
        </View>
      ) : null}

      {step !== 'closed' && Platform.OS !== 'web' ? (
        Platform.OS === 'ios' ? (
          <View className="w-full p-4 bg-surface rounded-lg border border-border/30">
            <DateTimePicker
              value={startValue}
              mode="datetime"
              display="inline"
              minimumDate={new Date()}
              onChange={(e, d) => {
                if (e.type === 'set' && d) onChange(d.getTime());
              }}
              accentColor={colors.accent}
            />
            <Button size="sm" variant="quiet" fullWidth onPress={() => setStep('closed')} className="mt-2">
              Done
            </Button>
          </View>
        ) : (
          <DateTimePicker
            value={pickedDay ?? startValue}
            mode={step === 'date' ? 'date' : 'time'}
            display="default"
            minimumDate={step === 'date' ? new Date() : undefined}
            onChange={onNative}
          />
        )
      ) : null}
    </View>
  );
}

/** Compact inline display of a reminder, for use in cards. */
export function DueDateLabel({ dueDate, repeat }: { dueDate: number; repeat?: Repeat }) {
  const colors = useThemeColors();
  const isOverdue = dueDate < Date.now() && !repeat;

  return (
    <View className="flex-row items-center">
      <Icon name={repeat ? 'repeat' : 'clock'} size={14} color={isOverdue ? colors.error : colors.fgTertiary} />
      <Text className="font-sans text-sm ml-1.5" style={{ color: isOverdue ? colors.error : colors.fgTertiary }}>
        {formatDueDate(dueDate)}
        {repeat ? ` · ${repeatLabel(repeat, dueDate).toLowerCase()}` : ''}
      </Text>
    </View>
  );
}
