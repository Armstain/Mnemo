import React, { useState } from 'react';
import { View, Text, Pressable, Platform } from 'react-native';
import { Calendar, X } from 'lucide-react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useThemeColors } from '@/hooks/use-theme';

interface DueDatePickerProps {
  value?: number; // timestamp
  onChange: (timestamp: number | undefined) => void;
}

function formatDueDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (dueDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return 'Due today';
  if (diffDays === 1) return 'Due tomorrow';
  if (diffDays === -1) return 'Overdue (yesterday)';
  if (diffDays < -1) return `Overdue (${Math.abs(diffDays)} days)`;
  if (diffDays <= 7) return `Due in ${diffDays} days`;

  return `Due ${date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

export function DueDatePicker({ value, onChange }: DueDatePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const colors = useThemeColors();

  const onDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    // On Android, the picker closes itself. On iOS, it might stay open depending on mode.
    if (Platform.OS === 'android') {
      setShowPicker(false);
    }
    
    if (event.type === 'set' && selectedDate) {
      // Set to end of day
      const d = new Date(selectedDate);
      d.setHours(23, 59, 59, 999);
      onChange(d.getTime());
    } else if (event.type === 'dismissed') {
      setShowPicker(false);
    }
  };

  const isOverdue = value ? value < Date.now() : false;

  return (
    <View className="flex-row items-center flex-wrap gap-2">
      <Pressable
        onPress={() => setShowPicker(true)}
        className="flex-row items-center px-4 py-2.5 rounded-xl border active:opacity-70"
        style={{
          backgroundColor: value
            ? isOverdue
              ? `${colors.error}24`
              : `${colors.accent}1A`
            : colors.surface,
          borderColor: value
            ? isOverdue
              ? `${colors.error}59`
              : `${colors.accent}40`
            : colors.border,
        }}
      >
        <Calendar
          size={14}
          color={value ? (isOverdue ? colors.error : colors.accent) : colors.fgTertiary}
          strokeWidth={2}
        />
        <Text
          className="font-sans-medium text-xs ml-2"
          style={{
            color: value ? (isOverdue ? colors.error : colors.accent) : colors.fgTertiary,
          }}
        >
          {value ? formatDueDate(value) : 'Set due date'}
        </Text>
      </Pressable>

      {value && (
        <Pressable
          onPress={() => onChange(undefined)}
          className="w-9 h-9 rounded-full bg-surface-warm items-center justify-center border border-border/30 active:opacity-60"
        >
          <X size={14} color={colors.fgTertiary} />
        </Pressable>
      )}

      {showPicker && (
        <>
          {Platform.OS === 'ios' ? (
            // For iOS, we might want a modal or a way to dismiss, 
            // but native inline/compact usually works well in-situ.
            // Let's use 'spinner' or 'inline' for Zen feel. 
            // 'inline' is beautiful on iOS 14+.
            <View className="w-full mt-2 p-4 bg-surface rounded-2xl border border-border/30 shadow-soft">
              <DateTimePicker
                value={value ? new Date(value) : new Date()}
                mode="date"
                display="inline"
                onChange={onDateChange}
                accentColor={colors.accent}
              />
              <ZenButton 
                title="Done" 
                size="sm" 
                variant="outline" 
                fullWidth 
                onPress={() => setShowPicker(false)} 
                className="mt-2"
              />
            </View>
          ) : (
            <DateTimePicker
              value={value ? new Date(value) : new Date()}
              mode="date"
              display="default"
              onChange={onDateChange}
            />
          )}
        </>
      )}
    </View>
  );
}

/** Import ZenButton inside the component file to avoid circular dependency if needed, 
 * but it's already used in capture.tsx. */
import { ZenButton } from '@/components/ZenButton';

/** Compact inline display of a due date, for use in cards. */
export function DueDateLabel({ dueDate }: { dueDate: number }) {
  const colors = useThemeColors();
  const isOverdue = dueDate < Date.now();

  return (
    <View className="flex-row items-center">
      <Calendar
        size={10}
        color={isOverdue ? colors.error : colors.fgTertiary}
        strokeWidth={2}
      />
      <Text
        className="font-sans text-[10px] ml-1"
        style={{ color: isOverdue ? colors.error : colors.fgTertiary }}
      >
        {formatDueDate(dueDate)}
      </Text>
    </View>
  );
}
