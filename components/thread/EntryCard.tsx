import React from 'react';
import { Platform, Pressable, View } from 'react-native';
import { TextInput } from '@/components/ui/TextInput';
import { Text } from '@/components/ui/Text';
import Markdown from 'react-native-markdown-display';

import { Button, IconButton } from '@/components/ui/Button';
import { ChecklistEditor } from '@/components/ui/ChecklistEditor';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ExternalLink } from '@/components/ExternalLink';
import { MeasureRows } from '@/components/thread/Measures';
import { MoveSheet } from '@/components/thread/MoveSheet';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useUndoToast } from '@/hooks/use-undo-toast';
import { isStructuring } from '@/lib/capture';
import { useAiProblem } from '@/lib/ai-mode';
import { entryText } from '@/lib/threads';
import { useThemeColors, type ThemeColors } from '@/hooks/use-theme';
import { formatEntryTime } from '@/utils/time';
import { noFocusRing } from '@/utils/web';
import type { Block, Entry } from '@/types/mnemo';

const SOURCE: Record<Entry['source'], { label: string; icon: IconName }> = {
  voice: { label: 'Voice', icon: 'mic' },
  text: { label: 'Typed', icon: 'pencil' },
  share: { label: 'Shared', icon: 'arrowUpRight' },
};

/** Markdown styles matched to the app's type scale and palette. */
export function useMarkdownStyles(bangla = false) {
  const colors = useThemeColors();
  return React.useMemo(() => markdownStyles(colors, bangla), [colors, bangla]);
}

// The web falls back letter by letter; phones need the Bangla face named.
const BODY_FONT = Platform.OS === 'web' ? 'InstrumentSans_400Regular, NotoSansBengali_400Regular' : 'InstrumentSans_400Regular';

function markdownStyles(colors: ThemeColors, bangla: boolean) {
  return {
    body: {
      color: colors.fg,
      fontSize: 15,
      lineHeight: bangla ? 24 : 23,
      fontFamily: bangla && Platform.OS !== 'web' ? 'NotoSansBengali_400Regular' : BODY_FONT,
    },
    paragraph: { marginTop: 0, marginBottom: 8 },
    heading1: { color: colors.fg, fontSize: 20, fontWeight: '600' as const, marginTop: 4, marginBottom: 6 },
    heading2: { color: colors.fg, fontSize: 17, fontWeight: '600' as const, marginTop: 4, marginBottom: 6 },
    heading3: { color: colors.fg, fontSize: 15, fontWeight: '600' as const, marginTop: 4, marginBottom: 4 },
    strong: { fontWeight: '600' as const, color: colors.fg },
    em: { fontStyle: 'italic' as const },
    link: { color: colors.accent },
    bullet_list: { marginBottom: 4 },
    bullet_list_icon: { color: colors.fgTertiary },
    ordered_list_icon: { color: colors.fgTertiary },
    code_inline: { backgroundColor: colors.surfaceHigh, color: colors.fg, borderRadius: 4, paddingHorizontal: 4 },
    code_block: { backgroundColor: colors.surfaceHigh, color: colors.fg, borderRadius: 8, padding: 10 },
    fence: { backgroundColor: colors.surfaceHigh, color: colors.fg, borderRadius: 8, padding: 10 },
    blockquote: {
      backgroundColor: colors.surfaceHigh,
      borderLeftColor: colors.accent,
      borderLeftWidth: 3,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    hr: { backgroundColor: colors.border, height: 1 },
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The address without its scheme or host, for a link that has no title yet. */
function pathOf(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return pathname === '/' && !search ? '' : `${pathname}${search}`;
  } catch {
    return '';
  }
}

/** One link block: the page's title (or its address) and where it's from. */
function LinkBlock({ block }: { block: Extract<Block, { kind: 'link' }> }) {
  const colors = useThemeColors();
  return (
    <ExternalLink href={block.url} asChild>
      <Pressable
        className="flex-row items-center rounded-sm px-3.5 py-3 active:opacity-70"
        style={{ backgroundColor: colors.surfaceLowest, borderWidth: 1, borderColor: colors.border }}
      >
        <View className="flex-1 mr-3" style={{ minWidth: 0 }}>
          <Text className="font-sans-medium text-sm" style={{ color: colors.fg }} numberOfLines={1}>
            {block.title || hostOf(block.url)}
          </Text>
          {(() => {
            // Second line: where it's from — or, with no title yet, the rest
            // of the address, so the host isn't printed twice.
            const detail = block.title ? block.site || hostOf(block.url) : pathOf(block.url);
            return detail ? (
              <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                {detail}
              </Text>
            ) : null;
          })()}
          {block.why ? (
            <Text className="font-sans text-sm mt-1.5" style={{ color: colors.fgSecondary }}>
              {block.why}
            </Text>
          ) : null}
        </View>
        <Icon name="arrowUpRight" size={16} color={colors.fgTertiary} />
      </Pressable>
    </ExternalLink>
  );
}

/**
 * One capture in a thread's timeline: when and how it arrived, then its
 * blocks. Its menu edits the text or deletes the entry.
 */
export function EntryCard({
  entry,
  onRetry,
  onMoved,
  onDeleted,
}: {
  entry: Entry;
  onRetry?: () => void;
  /** After a move: the thread the entry now lives in. */
  onMoved?: (threadId: string) => void;
  /** After a delete; `threadRemoved` when it was the thread's last entry. */
  onDeleted?: (threadRemoved: boolean) => void;
}) {
  const colors = useThemeColors();
  const md = useMarkdownStyles(/[\u0980-\u09FF]/.test(entryText(entry)));
  const { updateEntry, deleteEntry, undoDeleteEntry, getThread } = useMnemoStore();
  const { showUndoToast } = useUndoToast();
  const aiProblem = useAiProblem();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [moving, setMoving] = React.useState(false);

  const textIndex = entry.blocks.findIndex((b) => b.kind === 'text');
  const text = textIndex >= 0 ? (entry.blocks[textIndex] as Extract<Block, { kind: 'text' }>).markdown : '';
  const [draft, setDraft] = React.useState(text);
  const source = SOURCE[entry.source];
  const waitingForVoice = entry.pending && entry.blocks.length === 0;

  const replaceBlock = (index: number, block: Block) =>
    updateEntry(entry.id, { blocks: entry.blocks.map((b, i) => (i === index ? block : b)) });

  const saveText = () => {
    const markdown = draft.trim();
    const others = entry.blocks.filter((b) => b.kind !== 'text');
    updateEntry(entry.id, {
      blocks: markdown ? [{ kind: 'text', markdown }, ...others] : others,
      // Still waiting for the AI: it should tidy what's there now. (If it's
      // already out with the AI, the edit is kept over its version.)
      ...(entry.pending && entry.pendingRawText && markdown && !isStructuring(entry.id)
        ? { pendingRawText: markdown }
        : {}),
    });
    setEditing(false);
  };

  // No "are you sure?": the entry can be brought back from the toast.
  const remove = () => {
    const threadTitle = getThread(entry.threadId)?.title;
    const { threadRemoved } = deleteEntry(entry.id);
    showUndoToast(
      threadRemoved && threadTitle ? `"${threadTitle}" deleted` : 'Entry deleted',
      () => undoDeleteEntry(entry.id),
    );
    onDeleted?.(threadRemoved);
  };

  return (
    <View className="rounded-lg px-5 py-4" style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      {/* When and how it arrived */}
      <View className="flex-row items-center">
        <Icon name={source.icon} size={14} color={colors.fgTertiary} />
        <Text className="font-sans-medium text-sm ml-1.5 flex-1" style={{ color: colors.fgTertiary }}>
          {source.label} · {formatEntryTime(entry.createdAt)}
          {entry.filing.by === 'auto' || entry.filing.by === 'focus' ? (
            <Text style={{ color: colors.accent }}>{'  ·  Filed for you'}</Text>
          ) : null}
        </Text>
        {entry.pending ? (
          <Pressable
            onPress={onRetry}
            disabled={!onRetry}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Waiting to process. Tap to try now."
            className="flex-row items-center rounded-full px-2.5 h-7 mr-1 active:opacity-70"
            style={{ backgroundColor: colors.surfaceHigh }}
          >
            <Text className="font-sans-medium text-xs" style={{ color: colors.fgSecondary }}>
              {aiProblem ? 'Waiting for Gemini' : 'Processing'}
              {onRetry ? ' · Retry' : ''}
            </Text>
          </Pressable>
        ) : null}
        {!waitingForVoice && !editing ? (
          <IconButton
            icon={menuOpen ? 'x' : 'more'}
            label={menuOpen ? 'Close entry menu' : 'Entry options'}
            variant="bare"
            size={32}
            onPress={() => setMenuOpen((v) => !v)}
          />
        ) : null}
      </View>

      {menuOpen && (
        <View className="flex-row gap-2 mt-2 mb-1">
          <Button
            variant="quiet"
            size="sm"
            icon="pencil"
            onPress={() => {
              setDraft(text);
              setEditing(true);
              setMenuOpen(false);
            }}
          >
            Edit
          </Button>
          <Button
            variant="quiet"
            size="sm"
            icon="arrowUpRight"
            onPress={() => {
              setMenuOpen(false);
              setMoving(true);
            }}
          >
            Move
          </Button>
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            onPress={() => {
              setMenuOpen(false);
              remove();
            }}
          >
            Delete
          </Button>
        </View>
      )}

      <View className="mt-2 gap-3">
        {waitingForVoice ? (
          <Text className="font-quote text-body" style={{ color: colors.fgSecondary }}>
            Transcribing your recording…
          </Text>
        ) : null}

        {editing ? (
          <View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              textAlignVertical="top"
              selectionColor={colors.accent}
              placeholder="What happened?"
              placeholderTextColor={colors.fgTertiary}
              className="font-sans text-body rounded-sm p-3"
              style={[
                {
                  color: colors.fg,
                  minHeight: 96,
                  lineHeight: 23,
                  backgroundColor: colors.surfaceLowest,
                  borderWidth: 1,
                  borderColor: colors.border,
                },
                noFocusRing,
              ]}
            />
            <View className="flex-row justify-end gap-2 mt-3">
              <Button variant="ghost" size="sm" onPress={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" icon="check" onPress={saveText}>
                Save
              </Button>
            </View>
          </View>
        ) : null}

        {entry.blocks.map((block, index) => {
          if (block.kind === 'text') {
            if (editing) return null;
            return (
              <Markdown key={index} style={md}>
                {block.markdown}
              </Markdown>
            );
          }
          if (block.kind === 'checklist') {
            return (
              <ChecklistEditor
                key={index}
                items={block.items}
                editable={false}
                onChange={(items) => replaceBlock(index, { ...block, items })}
              />
            );
          }
          if (block.kind === 'link') return <LinkBlock key={index} block={block} />;
          if (block.kind === 'measures') return <MeasureRows key={index} items={block.items} />;
          // Charts arrive with smart captures (spec step 3); until then show their title.
          return (
            <Text key={index} className="font-sans-medium text-sm" style={{ color: colors.fgSecondary }}>
              {block.title}
            </Text>
          );
        })}

      </View>
      <MoveSheet entry={entry} visible={moving} onClose={() => setMoving(false)} onMoved={onMoved} />
    </View>
  );
}
