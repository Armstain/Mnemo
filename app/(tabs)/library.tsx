import React, { useState, useMemo, useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { AnimatePresence, MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoteRow } from '@/components/ui/NoteRow';
import { NoteListSkeleton } from '@/components/ui/NoteListSkeleton';
import { SearchBar } from '@/components/SearchBar';
import { Pill } from '@/components/ui/Pill';
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
        className="mb-4 flex-row items-baseline justify-between"
      >
        <Text className="text-display font-display text-fg">Library</Text>
        <Text className="font-sans text-xs text-fg-tertiary">
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
          placeholder="Search your thoughts..."
        />
      </MotiView>

      {/* Category filter */}
      <MotiView {...enter.fade(2)}
        className="mb-1"
      >
        <Text className="font-sans-medium text-[9px] text-fg-tertiary tracking-widest uppercase mb-0.5 px-0.5">
          Category
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingRight: 20, paddingVertical: 6 }}
        >
          <Pill
            tone={colors.fgSecondary}
            size="sm"
            dot={false}
            outline={selectedCategory !== 'all'}
            selected={selectedCategory === 'all'}
            onPress={() => setSelectedCategory('all')}
          >
            All
          </Pill>
          {CATEGORY_LIST.map((cat) => {
            const config = categories[cat];
            return (
              <Pill
                key={cat}
                tone={config.color}
                size="sm"
                dot={false}
                outline={selectedCategory !== cat}
                selected={selectedCategory === cat}
                onPress={() => setSelectedCategory(selectedCategory === cat ? 'all' : cat)}
              >
                {config.label}
              </Pill>
            );
          })}
        </ScrollView>
      </MotiView>

      {/* Status filter */}
      <MotiView {...enter.fade(2)}
        className="mb-3"
      >
        <Text className="font-sans-medium text-[9px] text-fg-tertiary tracking-widest uppercase mb-0.5 px-0.5">
          Status
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 7, paddingVertical: 6 }}
        >
          {STATUS_FILTERS.map(({ key, label }) => (
            <Pill
              key={key}
              tone={colors.accent}
              size="sm"
              dot={false}
              outline={selectedStatus !== key}
              selected={selectedStatus === key}
              onPress={() => setSelectedStatus(key)}
            >
              {label}
            </Pill>
          ))}
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
