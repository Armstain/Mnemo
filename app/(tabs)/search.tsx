import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Clock, Sparkles } from 'lucide-react-native';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NoteRow } from '@/components/ui/NoteRow';
import { SearchBar } from '@/components/SearchBar';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { bm25Search } from '@/lib/bm25';
import { EASE_OUT } from '@/utils/motion';
import type { MnemoItem } from '@/types/mnemo';

/**
 * SearchScreen — A dedicated full-screen search experience.
 * Distinct from Library's browse/filter approach — this is pure search-first.
 */
export default function SearchScreen() {
  const { items, isLoaded } = useMnemoStore();
  const [query, setQuery] = useState('');
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  // Debounce is handled by the useMemo recalculation — fast enough for local BM25
  const results = useMemo(() => {
    if (!query.trim()) return [];
    return bm25Search(query, items);
  }, [query, items]);

  // Recent items (last 5 updated)
  const recentItems = useMemo(
    () => [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5),
    [items],
  );

  const hasQuery = query.trim().length > 0;

  const openItem = useCallback((item: MnemoItem) => {
    router.push(`/(tabs)/context?id=${item.id}` as any);
  }, []);

  if (!isLoaded) return <View className="flex-1" />;

  return (
    <View className="flex-1" style={{ paddingTop: insets.top + 16 }}>
      {/* Header */}
      <MotiView
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 400, easing: EASE_OUT }}
        className="px-6 mb-4"
      >
        <Text className="text-3xl font-sans-medium text-fg">Search</Text>
      </MotiView>

      {/* Search Input */}
      <MotiView
        from={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'timing', duration: 400, delay: 80, easing: EASE_OUT }}
        className="px-6 mb-4"
      >
        <SearchBar
          value={query}
          onChangeText={setQuery}
          placeholder="Search thoughts, notes, ideas..."
          autoFocus
        />
      </MotiView>

      <ScrollView
        className="flex-1 px-6"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: insets.bottom + 100 }}
      >
        {hasQuery ? (
          /* ── Search Results ────────────────────────────── */
          <>
            <Text className="font-sans text-xs text-fg-tertiary mb-2">
              {results.length} result{results.length !== 1 ? 's' : ''}
            </Text>

            {results.length === 0 ? (
              <MotiView
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: 250, easing: EASE_OUT }}
                className="py-20 items-center"
              >
                <Sparkles size={32} color={colors.fgTertiary} strokeWidth={1.5} />
                <Text className="font-sans text-sm mt-4 text-center text-fg-secondary">
                  No matches found for "{query}"
                </Text>
                <Text className="font-sans text-xs mt-1 text-center text-fg-tertiary">
                  Try different keywords
                </Text>
              </MotiView>
            ) : (
              results.map((item, index) => (
                <NoteRow
                  key={item.id}
                  item={item}
                  index={index}
                  onPress={() => openItem(item)}
                />
              ))
            )}
          </>
        ) : (
          /* ── Recent Activity ───────────────────────────── */
          <MotiView
            from={{ opacity: 0, translateY: 8 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 400, delay: 150, easing: EASE_OUT }}
          >
            <View className="flex-row items-center mb-2">
              <Clock size={14} color={colors.fgTertiary} strokeWidth={2} />
              <Text className="font-sans-medium text-xs ml-2 text-fg-tertiary">
                Recent
              </Text>
            </View>

            {recentItems.length === 0 ? (
              <View className="py-16 items-center">
                <Text className="font-sans text-sm text-center text-fg-secondary">
                  No items yet. Create your first thought!
                </Text>
              </View>
            ) : (
              recentItems.map((item, index) => (
                <NoteRow
                  key={item.id}
                  item={item}
                  index={index}
                  onPress={() => openItem(item)}
                />
              ))
            )}
          </MotiView>
        )}
      </ScrollView>
    </View>
  );
}
