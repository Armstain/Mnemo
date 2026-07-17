import React, { useState, useMemo, useEffect } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoteRow } from '@/components/ui/NoteRow';
import { SearchBar } from '@/components/SearchBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { bm25Search } from '@/lib/bm25';
import { CATEGORY_LIST, useCategories } from '@/utils/categories';
import { EASE_OUT } from '@/utils/motion';
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
  const { items, deleteItem, isLoaded } = useMnemoStore();
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

  if (!isLoaded) return <View className="flex-1" />;

  return (
    <View className="flex-1 px-5" style={{ paddingTop: insets.top + 16 }}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 400, easing: EASE_OUT }}
        className="mb-4 flex-row items-baseline justify-between"
      >
        <Text className="text-3xl font-sans-medium text-fg">Library</Text>
        <Text className="font-sans text-xs text-fg-tertiary">
          {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
        </Text>
      </MotiView>

      {/* Search */}
      <MotiView
        from={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'timing', duration: 400, delay: 80, easing: EASE_OUT }}
        className="mb-4"
      >
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search your thoughts..."
        />
      </MotiView>

      {/* Category filter — quiet text row, active gets the category's color */}
      <MotiView
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 400, delay: 140, easing: EASE_OUT }}
        className="mb-1"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 18, paddingRight: 20, paddingVertical: 6 }}
        >
          <FilterTab
            label="All"
            active={selectedCategory === 'all'}
            activeColor={colors.fg}
            inactiveColor={colors.fgTertiary}
            onPress={() => setSelectedCategory('all')}
          />
          {CATEGORY_LIST.map((cat) => {
            const config = categories[cat];
            return (
              <FilterTab
                key={cat}
                label={config.label}
                active={selectedCategory === cat}
                activeColor={config.color}
                inactiveColor={colors.fgTertiary}
                onPress={() =>
                  setSelectedCategory(selectedCategory === cat ? 'all' : cat)
                }
              />
            );
          })}
        </ScrollView>
      </MotiView>

      {/* Status filter — same quiet pattern, accent-colored */}
      <MotiView
        from={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'timing', duration: 400, delay: 180, easing: EASE_OUT }}
        className="mb-3"
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 18, paddingVertical: 6 }}
        >
          {STATUS_FILTERS.map(({ key, label }) => (
            <FilterTab
              key={key}
              label={label}
              active={selectedStatus === key}
              activeColor={colors.accent}
              inactiveColor={colors.fgTertiary}
              onPress={() => setSelectedStatus(key)}
            />
          ))}
        </ScrollView>
      </MotiView>

      {/* Results */}
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {filteredItems.length === 0 ? (
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 400, easing: EASE_OUT }}
            className="py-20 items-center"
          >
            <Text className="text-4xl mb-4">🌿</Text>
            <Text className="font-sans text-sm text-fg-secondary">
              {searchQuery ? 'No matching items found' : 'No items yet'}
            </Text>
          </MotiView>
        ) : (
          <View>
            {filteredItems.map((item, index) => (
              <NoteRow
                key={item.id}
                item={item}
                index={index}
                showStatus
                onPress={() =>
                  router.push(`/(tabs)/context?id=${item.id}` as any)
                }
                onDelete={() => deleteItem(item.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** Quiet text filter tab: colored text + 2px underline when active. */
function FilterTab({
  label,
  active,
  activeColor,
  inactiveColor,
  onPress,
}: {
  label: string;
  active: boolean;
  activeColor: string;
  inactiveColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={8} className="active:opacity-60">
      <Text
        className="font-sans-medium text-[13px]"
        style={{ color: active ? activeColor : inactiveColor }}
      >
        {label}
      </Text>
      <View
        className="h-0.5 rounded-full mt-1"
        style={{ backgroundColor: active ? activeColor : 'transparent' }}
      />
    </Pressable>
  );
}
