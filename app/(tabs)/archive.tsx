import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, Trash2 } from 'lucide-react-native';
import { useContextStore } from '@/hooks/use-context-store';
import { bm25Search } from '@/lib/bm25';
import { formatCompactDistance } from '@/utils/time';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { SearchBar } from '@/components/SearchBar';
import { ZenCard } from '@/components/ZenCard';

export default function ArchiveScreen() {
  const { contexts, deleteContext, isLoaded } = useContextStore();
  const [searchQuery, setSearchQuery] = useState('');

  if (!isLoaded) return null;

  const filteredContexts = bm25Search(searchQuery, contexts);

  return (
    <View className="flex-1 bg-bg px-5">
      <SafeAreaView className="flex-1">
        <View className="flex-1 pt-4">
          {/* Header - Compact */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            className="mb-6"
          >
            <Text className="font-sans text-xs text-fg-muted mb-1 uppercase tracking-wider">
              Library
            </Text>
            <Text className="text-3xl font-serif text-fg">
              Archive
            </Text>
          </MotiView>

          {/* Search */}
          <MotiView
            from={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 500, delay: 100 }}
            className="mb-6"
          >
            <SearchBar 
              value={searchQuery} 
              onChangeText={setSearchQuery} 
              placeholder="Search archive..." 
            />
          </MotiView>

          {/* Results List */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {filteredContexts.length === 0 ? (
              <MotiView
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: 500 }}
                className="py-20 items-center bg-surface-warm/20 rounded-2xl border border-dashed border-border"
              >
                <Text className="text-4xl mb-4">🌿</Text>
                <Text className="font-sans text-sm text-fg-muted">
                  {searchQuery ? 'No matching notes found' : 'No notes yet'}
                </Text>
              </MotiView>
            ) : (
              <View className="pb-32">
                {filteredContexts.map((ctx, index) => (
                  <ZenCard
                    key={ctx.id}
                    compact
                    onPress={() => router.push(`/(tabs)/context?id=${ctx.id}` as any)}
                    title={ctx.title}
                    label={formatCompactDistance(ctx.createdAt)}
                    delay={200 + index * 50}
                  >
                    <View className="flex-row justify-between items-end">
                      <View className="flex-1 mr-4">
                        <Text className="font-sans text-[13px] text-fg-muted leading-relaxed" numberOfLines={2}>
                          {ctx.notes.trim() || "No content summary."}
                        </Text>
                        
                        <View className="flex-row items-center gap-2 mt-3">
                          <View
                            className={`px-2 py-0.5 rounded-full ${
                              ctx.summary
                                ? 'bg-accent/10'
                                : ctx.pending
                                ? 'bg-accent-warm/10'
                                : 'bg-surface-warm'
                            }`}
                          >
                            <Text
                              className={`font-sans-medium text-[9px] uppercase tracking-tighter ${
                                ctx.summary
                                  ? 'text-accent'
                                  : ctx.pending
                                  ? 'text-accent-warm'
                                  : 'text-fg-muted'
                              }`}
                            >
                              {ctx.summary ? 'Analyzed' : ctx.pending ? 'Queued' : 'Draft'}
                            </Text>
                          </View>
                        </View>
                      </View>
                      
                      <View className="items-center gap-4">
                        <Pressable
                          onPress={() => deleteContext(ctx.id)}
                          className="p-1 active:bg-error/10 rounded-full"
                          hitSlop={12}
                        >
                          <Trash2 size={14} color="#C17A6A" />
                        </Pressable>
                        <ChevronRight size={14} color="#9E9890" strokeWidth={2.5} />
                      </View>
                    </View>
                  </ZenCard>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}
