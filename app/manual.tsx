import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Check, X } from 'lucide-react-native';
import { useContextStore } from '@/hooks/use-context-store';
import { processVoiceDump } from '@/lib/gemini';
import { ZenButton } from '@/components/ZenButton';
import { MotiView } from 'moti';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ManualEntryScreen() {
  const insets = useSafeAreaInsets();
  const { addContext } = useContextStore();
  const [text, setText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCommit = async () => {
    if (!text.trim()) return;
    setIsProcessing(true);
    setError(null);

    try {
      const processed = await processVoiceDump(text);
      const newCtx = addContext({
        title: processed.title,
        notes: processed.notes,
        links: processed.links,
        summary: processed.summary
      });
      router.replace(`/(tabs)/context?id=${newCtx.id}` as any);
    } catch (e) {
      // AI unavailable — save the raw text as a pending note
      const firstLine = text.trim().split('\n')[0];
      const title = firstLine.length > 45 ? firstLine.substring(0, 45) + '…' : firstLine || 'Quick note';
      const newCtx = addContext({
        title,
        notes: text.trim(),
        links: [],
        pending: true,
        pendingRawText: text.trim(),
      });
      router.replace(`/(tabs)/context?id=${newCtx.id}` as any);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View className="flex-1 bg-bg px-6">
      <View className="flex-1">
        {/* Header */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 500 }}
          className="mb-8"
          style={{ marginTop: Math.max(insets.top, 16) }}
        >
          <Text className="font-sans text-xs text-fg-muted mb-2 tracking-wide">
            Capture your thoughts
          </Text>
          <Text className="text-3xl font-serif text-fg">
            Write a note
          </Text>
        </MotiView>

        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          {/* Text Input Area */}
          <MotiView
            from={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 500, delay: 150 }}
          >
            <View className="min-h-[280px] rounded-[16px] bg-surface border border-border/50 p-6 shadow-soft mb-6">
              <TextInput
                multiline
                autoFocus
                placeholder="What's on your mind?"
                placeholderTextColor="#9E9890"
                className="font-sans text-base text-fg leading-7 min-h-[240px]"
                value={text}
                onChangeText={setText}
                textAlignVertical="top"
                selectionColor="#8B9E7E"
              />
            </View>
          </MotiView>

          {/* Character count */}
          <Text className="font-sans text-xs text-fg-muted text-right mb-6">
            {text.length} characters
          </Text>

          {error && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-error/10 rounded-[12px] p-4 mb-6"
            >
              <Text className="font-sans text-sm text-error">
                {error}
              </Text>
            </MotiView>
          )}
        </ScrollView>

        {/* Actions */}
        <MotiView
          from={{ opacity: 0, translateY: 12 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 300 }}
          className="gap-3 pb-12"
        >
          <ZenButton
            onPress={handleCommit}
            disabled={isProcessing || !text.trim()}
            title={isProcessing ? "Saving..." : "Save note"}
            variant="primary"
            size="lg"
            fullWidth
            hapticIntensity="medium"
            icon={isProcessing ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Check size={22} color="#FFFFFF" />}
          />
          <ZenButton
            onPress={() => router.back()}
            title="Cancel"
            variant="ghost"
            size="md"
            fullWidth
            icon={<X size={18} color="#3D3A36" />}
          />
        </MotiView>
      </View>
    </View>
  );
}
