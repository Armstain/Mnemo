import React from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { IconButton } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { bm25Scored } from '@/lib/bm25';
import { noFocusRing } from '@/utils/web';
import { entryText } from '@/lib/threads';
import type { Entry } from '@/types/mnemo';

/**
 * Moves one entry to another thread, or into a thread of its own: the fix
 * for anything auto-filing got wrong, always one tap away on the entry.
 */
export function MoveSheet({
  entry,
  visible,
  onClose,
  onMoved,
}: {
  entry: Entry;
  visible: boolean;
  onClose: () => void;
  onMoved?: (threadId: string) => void;
}) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const { items, moveEntry, moveEntryToNewThread, removeThreadNow, snapshot, getThread } = useMnemoStore();
  const [query, setQuery] = React.useState('');

  const open = items.filter(
    (t) => t.id !== entry.threadId && !t.pending && (t.status === 'active' || t.status === 'paused'),
  );
  const shown = query.trim()
    ? bm25Scored(query, open).map(({ doc }) => doc)
    : [...open].sort((a, b) => b.updatedAt - a.updatedAt);

  const finish = (threadId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The thread it left is gone if this was its only entry.
    const from = entry.threadId;
    if (!snapshot().entries.some((e) => e.threadId === from)) removeThreadNow(from);
    setQuery('');
    onClose();
    onMoved?.(threadId);
  };

  const moveTo = (threadId: string) => {
    moveEntry(entry.id, threadId, { by: 'user' });
    finish(threadId);
  };

  const moveToNew = () => {
    const from = getThread(entry.threadId);
    const firstLine = entryText(entry).split('\n')[0].replace(/[#*_>`]/g, '').trim();
    const created = moveEntryToNewThread(entry.id, {
      title: firstLine ? (firstLine.length > 50 ? `${firstLine.slice(0, 50)}…` : firstLine) : 'New thread',
      category: from?.category ?? 'general',
      tags: [],
    });
    if (created) finish(created.id);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable className="flex-1" style={{ backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} />
      <View
        className="rounded-t-xl px-5 pt-3"
        style={{ backgroundColor: colors.bg, maxHeight: '80%', paddingBottom: Math.max(insets.bottom, 16) + 8 }}
      >
        <View className="self-center w-10 h-1 rounded-full mb-3" style={{ backgroundColor: colors.border }} />
        <View className="flex-row items-center justify-between mb-3">
          <Text className="font-display text-heading" style={{ color: colors.fg }}>
            Move entry to…
          </Text>
          <IconButton icon="x" label="Close" variant="bare" onPress={onClose} />
        </View>

        <View
          className="flex-row items-center rounded-full px-4 h-11 mb-3"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
          <Icon name="search" size={16} color={colors.fgTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Find a thread"
            placeholderTextColor={colors.fgTertiary}
            className="flex-1 font-sans text-body ml-2"
            style={[{ color: colors.fg }, noFocusRing]}
          />
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={moveToNew}
            accessibilityRole="button"
            className="flex-row items-center rounded-lg px-4 py-3.5 mb-3 active:opacity-70"
            style={{ backgroundColor: colors.accentSoft }}
          >
            <Icon name="plus" size={18} color={colors.accent} stroke={2.2} />
            <Text className="font-sans-semi text-body ml-3" style={{ color: colors.accent }}>
              Its own new thread
            </Text>
          </Pressable>
          {shown.length > 0 ? (
            <ThreadList>
              {shown.slice(0, 30).map((t, i, list) => (
                <ThreadRow key={t.id} item={t} index={i} last={i === list.length - 1} onPress={() => moveTo(t.id)} />
              ))}
            </ThreadList>
          ) : (
            <Text className="font-sans text-sm text-center py-6" style={{ color: colors.fgTertiary }}>
              No other open threads{query ? ' match' : ''}.
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
