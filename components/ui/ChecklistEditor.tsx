import React, { useState, useRef } from 'react';
import { View, Pressable } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { noFocusRing } from '@/utils/web';
import type { TextInput as RNTextInput } from 'react-native';
import { Text } from '@/components/ui/Text';
import * as Haptics from 'expo-haptics';
import { useThemeColors } from '@/hooks/use-theme';
import { useStatusConfig } from '@/utils/categories';
import { Icon } from '@/components/ui/Icon';
import { MotiView } from 'moti';
import { Animated, usePressScale } from '@/hooks/use-press-scale';
import type { ChecklistItem } from '@/types/mnemo';

interface ChecklistEditorProps {
  items: ChecklistItem[];
  onChange: (items: ChecklistItem[]) => void;
  /** If true, allow adding/removing items. If false, only toggling is allowed. */
  editable?: boolean;
  /** Compact mode for inline display in cards. */
  compact?: boolean;
}

function generateItemId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function ChecklistEditor({
  items,
  onChange,
  editable = true,
  compact = false,
}: ChecklistEditorProps) {
  const [newItemText, setNewItemText] = useState('');
  const inputRef = useRef<RNTextInput>(null);
  const colors = useThemeColors();
  const statusColors = useStatusConfig();

  const toggleItem = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(
      items.map((item) =>
        item.id === id ? { ...item, checked: !item.checked } : item,
      ),
    );
  };

  const addItem = () => {
    const text = newItemText.trim();
    if (!text) return;

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange([
      ...items,
      { id: generateItemId(), text, checked: false },
    ]);
    setNewItemText('');
    inputRef.current?.focus();
  };

  const removeItem = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onChange(items.filter((item) => item.id !== id));
  };

  const checkedCount = items.filter((i) => i.checked).length;
  const totalCount = items.length;
  const progress = totalCount > 0 ? checkedCount / totalCount : 0;

  return (
    <View>
      {/* Progress bar */}
      {totalCount > 0 && (
        <View className={`mb-3 ${compact ? 'mb-2' : 'mb-4'}`}>
          <View className="flex-row justify-between items-center mb-1.5">
            <Text className="font-sans-medium text-sm text-fg-muted">
              Progress
            </Text>
            <Text className="font-sans text-sm text-fg-muted">
              {checkedCount} of {totalCount}
            </Text>
          </View>
          <View className="h-1.5 bg-surface-warm rounded-full overflow-hidden">
            {/* Grows from the left (a transform, so it stays on the UI thread). */}
            <MotiView
              className="h-full rounded-full"
              animate={{ scaleX: Math.max(progress, 0.0001) }}
              transition={{ type: 'spring', damping: 18, stiffness: 160 }}
              style={{
                width: '100%',
                transformOrigin: 'left',
                backgroundColor:
                  progress === 1 ? statusColors.completed.color : colors.accent,
              } as any}
            />
          </View>
        </View>
      )}

      {/* Checklist items */}
      <View className={compact ? 'gap-1' : 'gap-2'}>
        {items.map((item) => (
          <View
            key={item.id}
            className={`flex-row items-center ${
              compact ? 'py-1' : 'py-2'
            }`}
          >
            <CheckBox checked={item.checked} onPress={() => toggleItem(item.id)} />

            <MotiView
              className="flex-1"
              animate={{ opacity: item.checked ? 0.7 : 1 }}
              transition={{ type: 'timing', duration: 200 }}
            >
              {editable ? (
                // Fix a misheard or mis-split item in place.
                <TextInput
                  value={item.text}
                  onChangeText={(text) => onChange(items.map((i) => (i.id === item.id ? { ...i, text } : i)))}
                  onEndEditing={() => {
                    if (!item.text.trim()) removeItem(item.id);
                  }}
                  accessibilityLabel="Checklist item"
                  selectionColor={colors.accent}
                  className="font-sans text-sm py-0"
                  style={[{ color: colors.fg }, noFocusRing]}
                />
              ) : (
                <Text
                  className={`font-sans text-sm ${item.checked ? 'line-through' : ''}`}
                  style={{ color: item.checked ? colors.fgTertiary : colors.fg }}
                >
                  {item.text}
                </Text>
              )}
            </MotiView>

            {editable && (
              <Pressable
                onPress={() => removeItem(item.id)}
                className="p-1 ml-2 active:opacity-50"
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.text}`}
              >
                <Icon name="x" size={14} color={colors.fgTertiary} />
              </Pressable>
            )}
          </View>
        ))}
      </View>

      {/* Add new item input */}
      {editable && (
        <View className="flex-row items-center mt-3 border-t border-border/30 pt-3">
          <View className="w-5 h-5 rounded-md border border-dashed border-border/60 items-center justify-center mr-3">
            <Icon name="plus" size={11} color={colors.fgTertiary} />
          </View>
          <TextInput
            ref={inputRef}
            value={newItemText}
            onChangeText={setNewItemText}
            placeholder="Add item..."
            placeholderTextColor={colors.fgTertiary}
            className="flex-1 font-sans text-sm text-fg py-0"
            selectionColor={colors.accent}
            onSubmitEditing={addItem}
            returnKeyType="done"
            blurOnSubmit={false}
          />
          {newItemText.trim().length > 0 && (
            <Pressable
              onPress={addItem}
              className="ml-2 w-7 h-7 rounded-full bg-accent items-center justify-center active:opacity-70"
              style={{ backgroundColor: colors.accent }}
            >
              <Icon name="plus" size={14} color={colors.accentInk} stroke={2.5} />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Compact progress bar for use in ResumeCards. */
export function ChecklistProgress({
  items,
}: {
  items: ChecklistItem[];
}) {
  const colors = useThemeColors();
  const statusColors = useStatusConfig();
  const checked = items.filter((i) => i.checked).length;
  const total = items.length;
  if (total === 0) return null;

  const progress = checked / total;

  return (
    <View className="flex-row items-center gap-2 mt-2">
      <View className="flex-1 h-1 bg-surface-warm rounded-full overflow-hidden">
        <View
          className="h-full rounded-full"
          style={{
            width: `${progress * 100}%`,
            backgroundColor:
              progress === 1 ? statusColors.completed.color : colors.accent,
          }}
        />
      </View>
      <Text className="font-sans text-xs text-fg-muted">
        {checked}/{total}
      </Text>
    </View>
  );
}

/** A checkbox that pops when ticked, with the tick scaling in. */
function CheckBox({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  const press = usePressScale(0.85);
  const was = React.useRef(checked);
  React.useEffect(() => {
    if (checked && !was.current) press.pop();
    was.current = checked;
  }, [checked]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      hitSlop={8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={{ marginRight: 12 }}
    >
      <Animated.View
        style={[
          {
            width: 20,
            height: 20,
            borderRadius: 6,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: checked ? colors.accent : 'transparent',
            borderColor: checked ? colors.accent : colors.border,
          },
          press.style,
        ]}
      >
        <MotiView
          animate={{ scale: checked ? 1 : 0.3, opacity: checked ? 1 : 0 }}
          transition={{ type: 'spring', damping: 12, stiffness: 300 }}
        >
          <Icon name="check" size={12} color={colors.accentInk} stroke={3} />
        </MotiView>
      </Animated.View>
    </Pressable>
  );
}
