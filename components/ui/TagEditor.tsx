import React from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextInput } from '@/components/ui/TextInput';
import { useThemeColors } from '@/hooks/use-theme';
import { noFocusRing } from '@/utils/web';

const MAX_TAGS = 8;

function clean(raw: string): string {
  return raw.replace(/^#+/, '').trim().toLowerCase().replace(/\s+/g, '-').slice(0, 30);
}

/** A thread's #tags: tap × to drop one, type to add (Enter, space after # or comma). */
export function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const colors = useThemeColors();
  const [draft, setDraft] = React.useState('');

  const add = (raw: string) => {
    const tag = clean(raw);
    setDraft('');
    if (!tag || tags.includes(tag) || tags.length >= MAX_TAGS) return;
    Haptics.selectionAsync();
    onChange([...tags, tag]);
  };

  return (
    <View className="flex-row flex-wrap items-center gap-2">
      {tags.map((tag) => (
        <View
          key={tag}
          className="flex-row items-center rounded-full pl-3 pr-1.5 h-8"
          style={{ backgroundColor: colors.surfaceHigh }}
        >
          <Text className="font-sans-medium text-sm" style={{ color: colors.fg }}>
            #{tag}
          </Text>
          <Pressable
            onPress={() => onChange(tags.filter((t) => t !== tag))}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Remove tag ${tag}`}
            className="w-6 h-6 items-center justify-center ml-0.5 active:opacity-50"
          >
            <Icon name="x" size={12} color={colors.fgTertiary} />
          </Pressable>
        </View>
      ))}
      {tags.length < MAX_TAGS ? (
        <TextInput
          value={draft}
          onChangeText={(t) => (/[,\s]$/.test(t) && t.trim() ? add(t) : setDraft(t))}
          onSubmitEditing={() => add(draft)}
          onBlur={() => draft.trim() && add(draft)}
          returnKeyType="done"
          autoCapitalize="none"
          placeholder={tags.length ? 'Add tag' : 'Add a tag, e.g. trip'}
          placeholderTextColor={colors.fgTertiary}
          accessibilityLabel="Add a tag"
          selectionColor={colors.accent}
          className="font-sans text-sm h-8 px-1"
          style={[{ color: colors.fg, minWidth: 110 }, noFocusRing]}
        />
      ) : null}
    </View>
  );
}
