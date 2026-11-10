import React, { useState, useEffect, useCallback } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Text } from '@/components/ui/Text';
import { useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Surface } from '@/components/ui/Card';
import { ThreadRow } from '@/components/ui/ThreadRow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { NoteListSkeleton } from '@/components/ui/NoteListSkeleton';
import { SearchBar } from '@/components/SearchBar';
import { Icon } from '@/components/ui/Icon';
import { NAV_CLEARANCE } from '@/components/ui/nav-layout';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useDeleteThread } from '@/hooks/use-thread-actions';
import { STATUS_FILTERS, useLibrarySearch, type FilterStatus } from '@/hooks/use-library-search';
import { useThemeColors } from '@/hooks/use-theme';
import { formatValue } from '@/lib/measures';
import { aiEnabled } from '@/lib/ai-mode';
import { usePreferences } from '@/lib/preferences';
import { AskCard, isQuestion } from '@/components/AskCard';
import { useEnter } from '@/hooks/use-enter';
import { CATEGORIES, type Category, type MnemoItem } from '@/types/mnemo';
import { openThread } from '@/lib/navigation';
import { capitalize } from '@/utils/text';

export default function LibraryScreen() {
  const enter = useEnter();
  const { items, entries, isLoaded } = useMnemoStore();
  const deleteThread = useDeleteThread();
  // AI on or off, and search by meaning, change what's offered.
  const { meaningSearch } = usePreferences();
  const ai = aiEnabled() && meaningSearch === true;
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('open');
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  // Allow other screens to open the library pre-filtered (?category=work).
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  useEffect(() => {
    const cat = Array.isArray(categoryParam) ? categoryParam[0] : categoryParam;
    if (cat && (CATEGORIES as readonly string[]).includes(cat)) {
      setSelectedCategory(cat as Category);
    }
  }, [categoryParam]);

  const { deferredQuery, period, words, totals, inPeriod, ranked, filteredItems } = useLibrarySearch({
    items,
    entries,
    query: searchQuery,
    category: selectedCategory,
    status: selectedStatus,
    ai,
  });

  // Rows play their entrance when the screen first appears, not again on every filter tap
  // (ten animated rings redrawing at once was most of the lag).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 900);
    return () => clearTimeout(t);
  }, []);

  const renderRow = useCallback(
    ({ item, index }: { item: MnemoItem; index: number }) => (
      <ThreadRow
        item={item}
        index={index}
        last={index === filteredItems.length - 1}
        // Only the first screenful plays the entrance; rows scrolled in just appear.
        cell={{ first: index === 0, animate: !entered && index < 10 }}
        onPress={() => openThread(item.id)}
        onSwipeDelete={() => deleteThread(item)}
      />
    ),
    [filteredItems.length, entered, deleteThread],
  );

  if (!isLoaded) {
    return (
      <View className="flex-1 px-5" style={{ paddingTop: insets.top + 16 }}>
        <NoteListSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 px-5" style={{ paddingTop: insets.top + 16 }}>
      <MotiView {...enter.rise(0)}
        className="mb-4 flex-row items-end justify-between"
      >
        <Text className="text-display font-display text-fg">Library</Text>
        <Text className="font-sans text-sm text-fg-tertiary mb-2">
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Text>
      </MotiView>

      <MotiView {...enter.pop(1)}
        className="mb-4"
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search your notes"
        />
      </MotiView>

      {period || totals.length > 0 || isQuestion(deferredQuery) ? (
        <View className="mb-3">
          {period ? (
            <View className="flex-row mb-2">
              <Pressable
                onPress={() => setSearchQuery(words)}
                accessibilityRole="button"
                accessibilityLabel={`Remove the time filter: ${period.label}`}
                className="flex-row items-center rounded-full pl-3 pr-2 h-8 active:opacity-70"
                style={{ backgroundColor: colors.accentSoft }}
              >
                <Icon name="calendar" size={13} color={colors.accent} />
                <Text className="font-sans-medium text-sm mx-1.5" style={{ color: colors.accent }}>
                  {period.label}
                </Text>
                <Icon name="x" size={12} color={colors.accent} />
              </Pressable>
            </View>
          ) : null}
          {totals.map((t) => (
            <Surface key={`${t.label}|${t.unit}`} className="flex-row items-center rounded-lg px-4 py-3 mb-2">
              <View className="flex-1">
                <Text className="font-sans-semi text-body" style={{ color: colors.fg }}>
                  {capitalize(t.label)}
                  {period ? ` · ${period.label.toLowerCase()}` : ''}
                </Text>
                <Text className="font-sans text-sm" style={{ color: colors.fgTertiary }}>
                  {t.count} {t.count === 1 ? 'entry' : 'entries'}
                  {t.threads > 1 ? ` in ${t.threads} threads` : ''}
                </Text>
              </View>
              <Text className="font-display" style={{ color: colors.fg, fontSize: 22, fontVariant: ['tabular-nums'] }}>
                {formatValue(t.total, t.unit)}
              </Text>
            </Surface>
          ))}
          {isQuestion(deferredQuery) ? (
            <AskCard question={deferredQuery} ranked={ranked} scope={inPeriod} canAsk={ai} />
          ) : null}
        </View>
      ) : null}

      <MotiView {...enter.fade(2)} className="mb-3">
        <Surface className="flex-row rounded-full p-1">
          {STATUS_FILTERS.map(({ key, label }) => {
            const selected = selectedStatus === key;
            return (
              <Pressable
                key={key}
                onPress={() => setSelectedStatus(key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                className="flex-1 items-center justify-center rounded-full h-9"
                style={{ backgroundColor: selected ? colors.surfaceRaised : 'transparent' }}
              >
                <Text
                  className="font-sans-semi text-sm"
                  style={{ color: selected ? colors.fg : colors.fgTertiary }}
                  numberOfLines={1}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </Surface>
      </MotiView>

      <MotiView {...enter.fade(2)} className="mb-4">
        <CategoryPicker
          value={selectedCategory}
          onChange={(cat) => setSelectedCategory(cat === selectedCategory ? 'all' : cat)}
          includeAll
          inset={20}
        />
      </MotiView>

      <FlatList
        className="flex-1"
        data={filteredItems}
        keyExtractor={(item) => item.id}
        renderItem={renderRow}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        windowSize={7}
        removeClippedSubviews
        contentContainerStyle={{ paddingBottom: insets.bottom + NAV_CLEARANCE }}
        ListEmptyComponent={
          <MotiView {...enter.fade(0)} className="py-20 items-center px-6">
            <Icon name="layers" size={28} color={colors.fgTertiary} stroke={1.6} />
            <Text className="font-sans-medium text-body mt-4" style={{ color: colors.fg }}>
              {searchQuery ? 'Nothing matches that' : 'Nothing here yet'}
            </Text>
            <Text className="font-sans text-sm mt-1 text-center" style={{ color: colors.fgTertiary }}>
              {searchQuery ? 'Try other words, or clear the filters.' : 'Threads you capture show up here.'}
            </Text>
          </MotiView>
        }
      />
    </View>
  );
}
