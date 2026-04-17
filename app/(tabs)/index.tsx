import { SearchBar } from '@/components/SearchBar';
import { ZenButton } from '@/components/ZenButton';
import { ZenCard } from '@/components/ZenCard';
import { useContextStore } from '@/hooks/use-context-store';
import { formatCompactDistance } from '@/utils/time';
import { router } from 'expo-router';
import { ChevronRight, Mic, Plus, Zap, Clock, Sparkles } from 'lucide-react-native';
import { MotiView } from 'moti';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function MnemoDashboard() {
  const { contexts, isLoaded } = useContextStore();
  const [searchQuery, setSearchQuery] = useState('');
  const insets = useSafeAreaInsets();

  const filteredContexts = useMemo(() => {
    if (!searchQuery.trim()) return contexts;
    return contexts.filter(ctx =>
      ctx.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ctx.notes.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [contexts, searchQuery]);

  if (!isLoaded) {
    return (
      <View className="flex-1 bg-bg items-center justify-center">
        <MotiView
          from={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ type: 'timing', duration: 800 }}
        >
          <Text className="font-sans-medium text-sm text-fg-muted tracking-wide">
            Loading your thoughts...
          </Text>
        </MotiView>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      <View className="flex-1" style={{ paddingTop: insets.top }}>
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ 
            paddingHorizontal: 20, 
            paddingTop: 16, 
            paddingBottom: insets.bottom + 100 
          }}
        >
          {/* Hero Section - Compact */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 600 }}
            className="mb-6"
          >
            <Text className="font-sans text-xs text-fg-muted mb-1 uppercase tracking-[1px]">
              {new Date().getHours() < 12 ? 'Good Morning' : new Date().getHours() < 17 ? 'Good Afternoon' : 'Good Evening'}
            </Text>
            <Text className="text-3xl font-serif text-fg leading-tight">
              What's on your mind?
            </Text>
          </MotiView>

          {/* Search Bar */}
          <MotiView
            from={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 500, delay: 100 }}
            className="mb-4"
          >
            <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
          </MotiView>

          {/* Quick Prompts */}
          <MotiView
            from={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ type: 'timing', duration: 600, delay: 200 }}
            className="flex-row gap-2 mb-8"
          >
            <QuickPrompt
              icon={<Zap size={14} color="#7A8F6A" />}
              label="Quick Note"
              onPress={() => router.push('/manual' as any)}
            />
            <QuickPrompt
              icon={<Mic size={14} color="#7A8F6A" />}
              label="Voice"
              onPress={() => router.push('/dump' as any)}
            />
          </MotiView>

          {/* Recent Notes Header */}
          <View className="flex-row justify-between items-baseline mb-4">
            <Text className="text-sm font-sans-semi text-fg-muted uppercase tracking-wider">
              {searchQuery ? 'Search Results' : 'Recent notes'}
            </Text>
            <Text className="font-sans text-[11px] text-fg-muted/60">
              {filteredContexts.length} total
            </Text>
          </View>

          {/* Notes List */}
          {filteredContexts.map((ctx, index) => (
            <MotiView
              key={ctx.id}
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400, delay: 300 + index * 40 }}
            >
              <Pressable
                onPress={() => router.push(`/(tabs)/context?id=${ctx.id}` as any)}
                className="mb-3 bg-surface border border-border/30 rounded-[20px] p-5 shadow-soft-sm active:bg-surface-warm/50 active:scale-[0.98]"
              >
                <View className="flex-row">
                  <View className="w-10 h-10 rounded-full bg-accent/5 items-center justify-center mr-4 border border-accent/10">
                    {ctx.pending ? (
                      <Clock size={16} color="#B2765A" />
                    ) : (
                      <Zap size={16} color="#7A8F6A" />
                    )}
                  </View>
                  
                  <View className="flex-1">
                    <View className="flex-row justify-between items-baseline mb-1">
                      <Text className="text-lg font-serif text-fg leading-tight flex-1 mr-2" numberOfLines={1}>
                        {ctx.title}
                      </Text>
                      <Text className="font-sans text-[10px] text-fg-muted uppercase tracking-tighter">
                        {formatCompactDistance(ctx.createdAt)}
                      </Text>
                    </View>
                    
                    <Text className="font-sans text-sm text-fg-muted leading-relaxed" numberOfLines={2}>
                      {ctx.notes.trim() || "No content summary."}
                    </Text>

                    {ctx.summary && (
                      <View className="flex-row items-center mt-3 pt-3 border-t border-border/20">
                        <Sparkles size={11} color="#8B9E7E" />
                        <Text className="font-sans-medium text-[11px] text-accent ml-1.5" numberOfLines={1}>
                          {ctx.summary.leftOff}
                        </Text>
                      </View>
                    )}
                  </View>
                  
                  <View className="justify-center ml-2">
                    <ChevronRight size={14} color="#9E9890" strokeWidth={2.5} />
                  </View>
                </View>
              </Pressable>
            </MotiView>
          ))}

          {/* Empty State / No Results */}
          {filteredContexts.length === 0 && (
            <MotiView
              from={{ opacity: 0, translateY: 12 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 600, delay: 300 }}
              className="py-12 items-center rounded-2xl border border-dashed border-border bg-surface-warm/30"
            >
              <Text className="text-4xl mb-3">🍃</Text>
              <Text className="font-serif text-lg text-fg mb-1">
                {searchQuery ? 'No matches found' : 'A quiet space'}
              </Text>
              <Text className="font-sans text-xs text-fg-muted text-center px-10 leading-relaxed mb-6">
                {searchQuery
                  ? 'Try searching for something else or clear the input.'
                  : 'Capture your first thought to get started. Use your voice or write it down.'}
              </Text>
              {!searchQuery && (
                <View className="flex-row gap-3">
                  <ZenButton
                    title="New Note"
                    size="sm"
                    onPress={() => router.push('/manual' as any)}
                    icon={<Plus size={16} color="white" />}
                  />
                </View>
              )}
            </MotiView>
          )}
        </ScrollView>

        {/* Floating Action Menu */}
        {!searchQuery && (
          <View className="absolute right-6 flex-col items-end gap-3" style={{ bottom: insets.bottom + 24 }}>
            <MotiView
              from={{ scale: 0, opacity: 0, translateY: 20 }}
              animate={{ scale: 1, opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15, delay: 600 }}
            >
              <Pressable
                onPress={() => router.push('/manual' as any)}
                className="flex-row items-center bg-surface border border-border px-4 py-3 rounded-full shadow-soft-lg active:scale-95"
              >
                <Zap size={18} color="#7A8F6A" strokeWidth={2} />
                <Text className="ml-2 font-sans-semi text-xs text-fg">Write note</Text>
              </Pressable>
            </MotiView>
            
            <MotiView
              from={{ scale: 0, opacity: 0, translateY: 20 }}
              animate={{ scale: 1, opacity: 1, translateY: 0 }}
              transition={{ type: 'spring', damping: 15, delay: 700 }}
            >
              <Pressable
                onPress={() => router.push('/dump' as any)}
                className="w-16 h-16 bg-accent rounded-full items-center justify-center shadow-soft-lg active:scale-95"
              >
                <Mic size={28} color="white" strokeWidth={2} />
              </Pressable>
            </MotiView>
          </View>
        )}
      </View>
    </View>
  );
}

function QuickPrompt({ label, icon, onPress }: { label: string, icon: React.ReactNode, onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center bg-accent/5 border border-accent/10 px-3 py-1.5 rounded-full active:bg-accent/10"
    >
      {icon}
      <Text className="ml-1.5 font-sans-medium text-xs text-accent">{label}</Text>
    </Pressable>
  );
}
