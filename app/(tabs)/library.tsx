import React, { useState, useMemo, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThreadList, ThreadRow } from '@/components/ui/ThreadRow';
import { CategoryPicker } from '@/components/ui/CategoryPicker';
import { NoteListSkeleton } from '@/components/ui/NoteListSkeleton';
import { SearchBar } from '@/components/SearchBar';
import { Icon } from '@/components/ui/Icon';
import { NAV_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { bm25Search } from '@/lib/bm25';
import { hybridSearch } from '@/lib/search';
import { CATEGORY_LIST } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import type { Category, ItemStatus, MnemoItem } from '@/types/mnemo';

// Debounce before the semantic (network) half of search fires.
const SEMANTIC_DEBOUNCE_MS = 300;

type FilterStatus = 'all' | ItemStatus;

const STATUS_FILTERS: { key: FilterStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'paused', label: 'Paused' },
  { key: 'completed', label: 'Done' },
  { key: 'archived', label: 'Archived' },
];

export default function LibraryScreen() {
  const enter = useEnter();
  const { items, isLoaded } = useMnemoStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('all');
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  // Allow other screens to open the library pre-filtered (?category=work).
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  useEffect(() => {
    const cat = Array.isArray(categoryParam) ? categoryParam[0] : categoryParam;
    if (cat && CATEGORY_LIST.includes(cat as Category)) {
      setSelectedCategory(cat as Category);
    }
  }, [categoryParam]);

  // Category/status filters first; search (if any) ranks within them.
  const scopedItems = useMemo(
    () =>
      items.filter(
        (i) =>
          (selectedCategory === 'all' || i.category === selectedCategory) &&
          (selectedStatus === 'all' || i.status === selectedStatus),
      ),
    [items, selectedCategory, selectedStatus],
  );

  // Instant keyword results on every keystroke, so search never feels
  // network-gated...
  const keywordResults = useMemo(
    () =>
      searchQuery.trim()
        ? bm25Search(searchQuery, scopedItems)
        : [...scopedItems].sort((a, b) => b.updatedAt - a.updatedAt),
    [searchQuery, scopedItems],
  );

  // ...upgraded to the hybrid keyword + meaning ranking once it resolves,
  // so "travel documents" still finds the passport note. null = not ready
  // for this query yet.
  const [hybridResults, setHybridResults] = useState<MnemoItem[] | null>(null);
  useEffect(() => {
    const trimmed = searchQuery.trim();
    // Clear immediately so a new query never shows the last one's results.
    setHybridResults(null);
    if (!trimmed) return;

    let cancelled = false;
    const handle = setTimeout(async () => {
      const fused = await hybridSearch(trimmed, scopedItems);
      if (!cancelled) setHybridResults(fused);
    }, SEMANTIC_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [searchQuery, scopedItems]);

  const filteredItems = hybridResults ?? keywordResults;

  if (!isLoaded) {
    return (
      <View className="flex-1 px-5" style={{ paddingTop: insets.top + 16 }}>
        <NoteListSkeleton />
      </View>
    );
  }

  return (
    <View className="flex-1 px-5" style={{ paddingTop: insets.top + 16 }}>
      {/* Header */}
      <MotiView {...enter.rise(0)}
        className="mb-4 flex-row items-end justify-between"
      >
        <Text className="text-display font-display text-fg">Library</Text>
        <Text className="font-sans text-sm text-fg-tertiary mb-2">
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Text>
      </MotiView>

      {/* Search */}
      <MotiView {...enter.pop(1)}
        className="mb-4"
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search your notes"
        />
      </MotiView>

      {/* Status — a segmented control, since exactly one is always on */}
      <MotiView {...enter.fade(2)} className="mb-3">
        <View
          className="flex-row rounded-full p-1"
          style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}
        >
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
        </View>
      </MotiView>

      {/* Category */}
      <MotiView {...enter.fade(2)} className="mb-4">
        <CategoryPicker
          value={selectedCategory}
          onChange={(cat) => setSelectedCategory(cat === selectedCategory ? 'all' : cat)}
          includeAll
          inset={20}
        />
      </MotiView>

      {/* Results */}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + NAV_CLEARANCE }}
      >
        {filteredItems.length === 0 ? (
          <MotiView {...enter.fade(0)} className="py-20 items-center px-6">
            <Icon name="layers" size={28} color={colors.fgTertiary} stroke={1.6} />
            <Text className="font-sans-medium text-body mt-4" style={{ color: colors.fg }}>
              {searchQuery ? 'Nothing matches that' : 'Nothing here yet'}
            </Text>
            <Text className="font-sans text-sm mt-1 text-center" style={{ color: colors.fgTertiary }}>
              {searchQuery ? 'Try other words, or clear the filters.' : 'Threads you capture show up here.'}
            </Text>
          </MotiView>
        ) : (
          <ThreadList>
            {filteredItems.map((item, index) => (
              <ThreadRow
                key={item.id}
                item={item}
                index={index}
                last={index === filteredItems.length - 1}
                onPress={() => router.push(`/(tabs)/context?id=${item.id}` as any)}
              />
            ))}
          </ThreadList>
        )}
      </ScrollView>
    </View>
  );
}
