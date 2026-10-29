import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { aiErrorText } from '@/lib/api-key';
import { askNotes, type NoteForQuestion } from '@/lib/gemini';
import { entryText } from '@/lib/threads';
import type { MnemoItem } from '@/types/mnemo';

const QUESTION =
  /\?\s*$|^(what|when|where|who|which|why|how|did|do|does|is|are|was|were|can|should|kobe|koto|ki|kokhon|kothay|keno|kara)\b|^(কত|কি|কী|কখন|কোথায়|কে|কেন|কবে|কারা)/i;

/** Whether a search reads as a question worth answering. */
export function isQuestion(query: string): boolean {
  return QUESTION.test(query.trim().normalize('NFC'));
}

const PER_NOTE_CHARS = 1500;
const MAX_NOTES = 8;

/**
 * "Ask Mnemo": answers a question from the few notes that match it best
 * (picked on the phone), and shows which ones it used.
 */
export function AskCard({ question, ranked }: { question: string; ranked: MnemoItem[] }) {
  const colors = useThemeColors();
  const { getEntries, getThread } = useMnemoStore();
  const [state, setState] = React.useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'done'; answer: string; sources: string[] } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // A new question starts over.
  React.useEffect(() => setState({ kind: 'idle' }), [question]);

  const ask = async () => {
    setState({ kind: 'asking' });
    const notes: NoteForQuestion[] = ranked.slice(0, MAX_NOTES).map((t) => {
      const text = getEntries(t.id)
        .map((e) => `[${new Date(e.createdAt).toDateString()}] ${entryText(e)}`)
        .join('\n')
        .slice(0, PER_NOTE_CHARS);
      return { id: t.id, title: t.title, text: text || t.content.slice(0, PER_NOTE_CHARS) };
    });
    try {
      const { answer, sourceIds } = await askNotes(question, notes);
      setState({ kind: 'done', answer, sources: sourceIds });
    } catch (e) {
      setState({ kind: 'error', message: aiErrorText(e) });
    }
  };

  return (
    <View className="rounded-lg p-4 mb-3" style={{ backgroundColor: colors.accentSoft }}>
      {state.kind === 'idle' ? (
        <Pressable onPress={ask} accessibilityRole="button" className="flex-row items-center active:opacity-70">
          <Icon name="sparkles" size={16} color={colors.accent} />
          <Text className="flex-1 font-sans-semi text-body ml-2" style={{ color: colors.fg }}>
            Ask your notes
          </Text>
          <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
            Ask
          </Text>
        </Pressable>
      ) : state.kind === 'asking' ? (
        <View className="flex-row items-center">
          <ActivityIndicator color={colors.accent} />
          <Text className="font-sans text-sm ml-2" style={{ color: colors.fgSecondary }}>
            Reading your notes…
          </Text>
        </View>
      ) : state.kind === 'error' ? (
        <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
          {state.message}
        </Text>
      ) : (
        <View>
          <View className="flex-row items-center mb-1.5">
            <Icon name="sparkles" size={14} color={colors.accent} />
            <Text className="font-sans-semi text-xs ml-1.5" style={{ color: colors.accent }}>
              FROM YOUR NOTES
            </Text>
          </View>
          <Text className="font-sans text-body leading-relaxed" style={{ color: colors.fg }}>
            {state.answer}
          </Text>
          {state.sources.length > 0 ? (
            <View className="flex-row flex-wrap gap-2 mt-3">
              {state.sources.map((id) => {
                const t = getThread(id);
                if (!t) return null;
                return (
                  <Pressable
                    key={id}
                    onPress={() => router.push(`/(tabs)/context?id=${id}`)}
                    accessibilityRole="button"
                    className="rounded-full px-3 h-8 items-center justify-center active:opacity-70"
                    style={{ backgroundColor: colors.surfaceLowest, maxWidth: '100%' }}
                  >
                    <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={1}>
                      {t.title}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
