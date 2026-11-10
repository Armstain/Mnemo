import React from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { router } from 'expo-router';

import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { aiErrorText } from '@/lib/api-key';
import { askNotes, type NoteForQuestion } from '@/lib/gemini';
import { packContext, type Hit } from '@/lib/retrieve';
import { findPassages } from '@/lib/search';
import type { MnemoItem } from '@/types/mnemo';

const QUESTION =
  /\?\s*$|^(what|when|where|who|which|why|how|did|do|does|is|are|was|were|can|should|kobe|koto|ki|kokhon|kothay|keno|kara)\b|^(কত|কি|কী|কখন|কোথায়|কে|কেন|কবে|কারা)/i;

/** Whether a search reads as a question worth answering. */
export function isQuestion(query: string): boolean {
  return QUESTION.test(query.trim().normalize('NFC'));
}

/** What you said, as it's shown: the passage's first lines. */
const SHOWN_CHARS = 220;

/**
 * A question typed into search. First, and always, what you said about it:
 * the passages that match best, found on the phone with nothing sent
 * anywhere, each opening its thread. Then, only if Smart mode is on and you
 * ask for it, an answer written from those same passages.
 */
export function AskCard({
  question,
  ranked,
  scope,
  canAsk,
}: {
  question: string;
  /** The threads the search found, best first. */
  ranked: MnemoItem[];
  /** Every thread the question may be answered from (those in the period searched). */
  scope: MnemoItem[];
  /** Whether an answer can be written (Smart mode is on). */
  canAsk: boolean;
}) {
  const colors = useThemeColors();
  const { getThread, snapshot } = useMnemoStore();
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [state, setState] = React.useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'done'; answer: string; sources: string[] } | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Which threads are in scope, not the array: any save makes a new one.
  const scopeKey = scope.map((t) => t.id).join(',');
  const scopeRef = React.useRef(scope);
  React.useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  // A new question starts over, and is looked up on the phone straight away.
  React.useEffect(() => {
    setState({ kind: 'idle' });
    setHits([]);
    let cancelled = false;
    findPassages(question, scopeRef.current, snapshot().entries).then((found) => {
      if (!cancelled) setHits(found);
    });
    return () => {
      cancelled = true;
    };
  }, [question, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async () => {
    setState({ kind: 'asking' });
    try {
      const notes: NoteForQuestion[] = packContext(hits);
      // No passage shares a word with the question: the threads the search found, as they begin.
      if (notes.length === 0) {
        notes.push(...ranked.slice(0, 6).map((t) => ({ id: t.id, title: t.title, text: t.content.slice(0, 1500) })));
      }
      const { answer, sourceIds } = await askNotes(question, notes);
      setState({ kind: 'done', answer, sources: sourceIds });
    } catch (e) {
      setState({ kind: 'error', message: aiErrorText(e) });
    }
  };

  // Nothing found, and no one to ask: the list below is the answer.
  if (hits.length === 0 && !canAsk) return null;

  return (
    <View className="rounded-lg p-4 mb-3" style={{ backgroundColor: colors.accentSoft }}>
      {state.kind === 'done' ? (
        <View className="mb-3">
          <View className="flex-row items-center mb-1.5">
            <Icon name="sparkles" size={14} color={colors.accent} />
            <Text className="font-sans-semi text-xs ml-1.5" style={{ color: colors.accent }}>
              SMART ANSWER
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
      ) : null}

      {hits.length > 0 ? (
        <View>
          <Text className="font-sans-semi text-xs mb-2" style={{ color: colors.accent }}>
            WHAT YOU SAID
          </Text>
          {hits.map(({ chunk }) => (
            <Pressable
              key={chunk.id}
              onPress={() => router.push(`/(tabs)/context?id=${chunk.threadId}`)}
              accessibilityRole="button"
              accessibilityLabel={`${chunk.title}: ${chunk.text.slice(0, SHOWN_CHARS)}`}
              className="rounded-md px-3 py-2.5 mb-2 active:opacity-70"
              style={{ backgroundColor: colors.surfaceLowest }}
            >
              <Text className="font-sans text-body leading-snug" style={{ color: colors.fg }} numberOfLines={3}>
                {chunk.text.length > SHOWN_CHARS ? `${chunk.text.slice(0, SHOWN_CHARS).trimEnd()}…` : chunk.text}
              </Text>
              <Text className="font-sans text-xs mt-1" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                {chunk.title} · {new Date(chunk.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {!canAsk || state.kind === 'done' ? null : state.kind === 'idle' ? (
        <Pressable onPress={ask} accessibilityRole="button" className="flex-row items-center h-9 active:opacity-70">
          <Icon name="sparkles" size={16} color={colors.accent} />
          <Text className="flex-1 font-sans-semi text-body ml-2" style={{ color: colors.fg }}>
            {hits.length > 0 ? 'Write an answer from these' : 'Ask your notes'}
          </Text>
          <Text className="font-sans-semi text-sm" style={{ color: colors.accent }}>
            Ask
          </Text>
        </Pressable>
      ) : state.kind === 'asking' ? (
        <View className="flex-row items-center h-9">
          <ActivityIndicator color={colors.accent} />
          <Text className="font-sans text-sm ml-2" style={{ color: colors.fgSecondary }}>
            Reading your notes…
          </Text>
        </View>
      ) : (
        <Text className="font-sans text-sm" style={{ color: colors.fgSecondary }}>
          {state.message}
        </Text>
      )}
    </View>
  );
}
