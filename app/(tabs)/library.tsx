import React, { useState, useMemo, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoteRow } from '@/components/ui/NoteRow';
import { NoteListSkeleton } from '@/components/ui/NoteListSkeleton';
import { SearchBar } from '@/components/SearchBar';
import { Icon } from '@/components/ui/Icon';
import { NAV_CLEARANCE } from '@/components/ui/FloatingTabBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { useThemeColors } from '@/hooks/use-theme';
import { bm25Search } from '@/lib/bm25';
import { CATEGORY_LIST, useCategories } from '@/utils/categories';
import { useEnter } from '@/utils/motion';
import type { Category, ItemStatus } from '@/types/mnemo';

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
  const { items, deleteItem, undoDelete, isLoaded } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'all'>('all');
  const [selectedStatus, setSelectedStatus] = useState<FilterStatus>('all');
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const categories = useCategories();

  // Allow other screens to open the library pre-filtered (?category=work).
  const { category: categoryParam } = useLocalSearchParams<{ category?: string }>();
  useEffect(() => {
    const cat = Array.isArray(categoryParam) ? categoryParam[0] : categoryParam;
    if (cat && CATEGORY_LIST.includes(cat as Category)) {
      setSelectedCategory(cat as Category);
    }
  }, [categoryParam]);

  const filteredItems = useMemo(() => {
    let result = items;

    if (selectedCategory !== 'all') {
      result = result.filter((i) => i.category === selectedCategory);
    }
    if (selectedStatus !== 'all') {
      result = result.filter((i) => i.status === selectedStatus);
    }
    if (searchQuery.trim()) {
      result = bm25Search(searchQuery, result);
    } else {
      result = [...result].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return result;
  }, [items, selectedCategory, selectedStatus, searchQuery]);

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
        <Text className="font-sans text-xs text-fg-tertiary mb-2">
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
          placeholder="Filter by keyword"
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
                className="flex-1 items-center justify-center rounded-full h-8"
                style={{ backgroundColor: selected ? colors.surfaceRaised : 'transparent' }}
              >
                <Text
                  className="font-sans-semi text-xs"
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

      {/* Category — neutral chips with a color dot, so the row doesn't read as a rainbow */}
      <MotiView {...enter.fade(2)} className="mb-2 -mx-5">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 6, paddingHorizontal: 20, paddingVertical: 4 }}
        >
          {(['all', ...CATEGORY_LIST] as const).map((cat) => {
            const selected = selectedCategory === cat;
            const dot = cat === 'all' ? null : categories[cat].color;
            return (
              <Pressable
                key={cat}
                onPress={() => setSelectedCategory(selected && cat !== 'all' ? 'all' : cat)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                className="flex-row items-center rounded-full px-3 h-8 active:opacity-70"
                style={{
                  backgroundColor: selected ? colors.fg : 'transparent',
                  borderWidth: 1,
                  borderColor: selected ? colors.fg : colors.border,
                }}
              >
                {dot && <View className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: dot }} />}
                <Text className="font-sans-medium text-xs" style={{ color: selected ? colors.bg : colors.fgSecondary }}>
                  {cat === 'all' ? 'All' : categories[cat].label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </MotiView>

      {/* Results */}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + NAV_CLEARANCE }}
      >
        {filteredItems.length === 0 ? (
          <MotiView {...enter.fade(0)}
            className="py-20 items-center"
          >
            <Icon name="layers" size={32} color={colors.fgTertiary} stroke={1.5} />
            <Text className="font-sans text-sm text-fg-secondary mt-4">
              {searchQuery ? 'No matching items found' : 'No items yet'}
            </Text>
          </MotiView>
        ) : (
          <View>
            {/* AnimatePresence so a deleted row leaves visibly. Without it
                the row teleported out while the undo toast sprang in — the
                only thing that animated was the confirmation of something
                that hadn't. */}
            <AnimatePresence>
              {filteredItems.map((item, index) => (
                <NoteRow
                  key={item.id}
                  item={item}
                  index={index}
                  showStatus
                  onPress={() =>
                    router.push(`/(tabs)/context?id=${item.id}` as any)
                  }
                  onDelete={() => {
                    deleteItem(item.id);
                    showUndoToast(`"${item.title}" deleted`, () => undoDelete(item.id));
                  }}
                />
              ))}
            </AnimatePresence>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
