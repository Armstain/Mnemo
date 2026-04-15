import React, { useState } from 'react';
import { View, Text, Pressable, ScrollView, SafeAreaView, TextInput } from 'react-native';
import { Search, ChevronRight, Trash2 } from 'lucide-react-native';
import { useContextStore } from '@/hooks/use-context-store';
import { bm25Search } from '@/lib/bm25';
import { formatDistanceToNow } from 'date-fns';
import { router } from 'expo-router';
import { MotiView } from 'moti';

export default function ArchiveScreen() {
  const { contexts, deleteContext, isLoaded } = useContextStore();
  const [searchQuery, setSearchQuery] = useState('');

  if (!isLoaded) return null;

  const filteredContexts = bm25Search(searchQuery, contexts);

  return (
    <View className="flex-1 bg-bg px-6">
      <SafeAreaView className="flex-1">
        <View className="flex-1 pt-8">
          {/* Header */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500 }}
            className="mb-8"
          >
            <Text className="font-sans text-xs text-fg-muted mb-2 tracking-wide">
              All your captured thoughts
            </Text>
            <Text className="text-3xl font-serif text-fg">
              Archive
            </Text>
          </MotiView>

          {/* Search */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 150 }}
            className="mb-8"
          >
            <View className="flex-row items-center bg-surface rounded-[16px] px-5 py-4 border border-border/60 shadow-soft-sm">
              <Search size={18} color="#9E9890" />
              <TextInput
                placeholder="Search your notes..."
                placeholderTextColor="#9E9890"
                className="flex-1 ml-3 font-sans text-sm text-fg"
                value={searchQuery}
                onChangeText={setSearchQuery}
                selectionColor="#8B9E7E"
              />
            </View>
          </MotiView>

          {/* Results */}
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {filteredContexts.length === 0 ? (
              <MotiView
                from={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ type: 'timing', duration: 500 }}
                className="py-20 items-center"
              >
                <Text className="text-4xl mb-4">🌿</Text>
                <Text className="font-sans text-sm text-fg-muted">
                  {searchQuery ? 'No matching notes found' : 'No notes yet'}
                </Text>
              </MotiView>
            ) : (
              <View className="gap-3 pb-32">
                {filteredContexts.map((ctx, index) => (
                  <MotiView
                    key={ctx.id}
                    from={{ opacity: 0, translateY: 12 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'timing', duration: 400, delay: 200 + index * 80 }}
                  >
                    <Pressable
                      onPress={() => router.push(`/(tabs)/context?id=${ctx.id}` as any)}
                      className="bg-surface rounded-[16px] p-6 border border-border/50 shadow-soft active:opacity-80 active:scale-[0.99]"
                    >
                      <View className="flex-row justify-between items-start mb-3">
                        <Text className="font-sans text-xs text-fg-muted tracking-wide">
                          {formatDistanceToNow(ctx.createdAt)} ago
                        </Text>
                        <Pressable
                          onPress={() => deleteContext(ctx.id)}
                          className="p-1.5 rounded-full active:bg-surface-warm"
                          hitSlop={8}
                        >
                          <Trash2 size={14} color="#9E9890" />
                        </Pressable>
                      </View>

                      <Text className="text-lg font-serif text-fg mb-2 leading-snug">
                        {ctx.title}
                      </Text>

                      <Text className="font-sans text-sm text-fg-muted leading-relaxed" numberOfLines={2}>
                        {ctx.notes}
                      </Text>

                      <View className="mt-4 pt-4 border-t border-border/40 flex-row justify-between items-center">
                        <View className="flex-row items-center gap-2">
                          <View
                            className={`px-2.5 py-1 rounded-full ${
                              ctx.summary
                                ? 'bg-accent/15'
                                : ctx.pending
                                ? 'bg-accent-warm/15'
                                : 'bg-surface-warm'
                            }`}
                          >
                            <Text
                              className={`font-sans-medium text-[10px] ${
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
                        <ChevronRight size={16} color="#9E9890" />
                      </View>
                    </Pressable>
                  </MotiView>
                ))}
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    </View>
  );
}
