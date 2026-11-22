import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { Surface, useSurfaceStyle } from '@/components/ui/Card';
import { KeyboardAvoid, ScreenHeader, useSafeTop } from '@/components/ui/Screen';
import { Pill } from '@/components/ui/Pill';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { Icon } from '@/components/ui/Icon';
import { Text } from '@/components/ui/Text';
import { TextInput } from '@/components/ui/TextInput';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { useThemeColors } from '@/hooks/use-theme';
import { rememberPreview, saveNote } from '@/lib/capture';
import { imageUri, keepImage, type ImageBlock } from '@/lib/images';
import { fetchLinkPreview, type LinkPreview } from '@/lib/link-preview';
import { takeIncomingShare, type IncomingShare } from '@/lib/shared';
import { resumeOrder } from '@/lib/when';
import { useEnter } from '@/hooks/use-enter';
import { noFocusRing } from '@/utils/web';
import { hostOf } from '@/utils/text';
import { openSaved } from '@/lib/navigation';

/** Text that is only the shared link adds nothing to keep as text. */
function textBesides(text: string | undefined, url: string | undefined): string {
  if (!text) return '';
  return (url ? text.replace(url, '') : text).trim();
}

/**
 * "Save to Mnemo", opened from another app's share sheet: the shared text,
 * link or photos, a line of your own, and which thread it goes to.
 */
export default function ShareScreen() {
  const enter = useEnter();
  const insets = useSafeAreaInsets();
  const top = useSafeTop();
  const surface = useSurfaceStyle();
  const colors = useThemeColors();
  const store = useMnemoStore();
  const [share] = useState<IncomingShare | null>(() => takeIncomingShare());
  const [note, setNote] = useState('');
  const [text, setText] = useState(() => textBesides(share?.text, share?.url));
  const [photos, setPhotos] = useState<ImageBlock[]>([]);
  const [keeping, setKeeping] = useState((share?.photos.length ?? 0) > 0);
  const [preview, setPreview] = useState<LinkPreview | null>(null);

  // Where it goes: the focus thread if there is one, else a new thread.
  const choices = useMemo(
    () => resumeOrder(store.getActiveItems(), { focusId: store.focusThreadId }).slice(0, 6),
    [store.items, store.focusThreadId], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [threadId, setThreadId] = useState<string | null>(() => store.focusThreadId ?? null);

  useEffect(() => {
    if (!share) {
      router.back();
      return;
    }
    let cancelled = false;
    (async () => {
      const kept: ImageBlock[] = [];
      for (const p of share.photos) {
        try {
          kept.push(await keepImage(p.uri));
        } catch {
          // A photo the phone can't read is skipped.
        }
      }
      if (!cancelled) {
        setPhotos(kept);
        setKeeping(false);
      }
    })();
    if (share.url) {
      fetchLinkPreview(share.url).then((p) => {
        if (cancelled || !p) return;
        rememberPreview(share.url!, p);
        setPreview(p);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!share) return null;

  const save = () => {
    const words = [note.trim(), text.trim()].filter(Boolean).join('\n\n');
    const saved = saveNote('share', {
      text: words,
      category: 'general',
      threadId: threadId ?? undefined,
      filing: threadId ? (threadId === store.focusThreadId ? { by: 'focus' } : { by: 'user' }) : undefined,
      images: photos,
      links: share.url ? [share.url] : [],
      title: preview?.title ?? share.title,
      store,
    });
    openSaved(saved);
  };

  const host = share.url ? hostOf(share.url) : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoid className="flex-1">
        <MotiView {...enter.rise(0)} style={{ paddingTop: top }}>
          <ScreenHeader
            onClose={() => router.back()}
            label="Cancel"
            title="Save to Mnemo"
            className="px-6 mb-4"
            trailing={
              <Button onPress={save} disabled={keeping} variant="primary" size="sm" icon="check">
                Save
              </Button>
            }
          />
        </MotiView>

        <ScrollView
          className="flex-1 px-6"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 24, gap: 20 }}
        >
          {share.url ? (
            <Surface className="flex-row items-center rounded-md p-3.5">
              {preview?.imageUrl ? (
                <Image source={{ uri: preview.imageUrl }} style={{ width: 56, height: 56, borderRadius: 10, marginRight: 12 }} />
              ) : (
                <View className="w-14 h-14 rounded-sm items-center justify-center mr-3" style={{ backgroundColor: colors.surfaceHigh }}>
                  <Icon name="arrowUpRight" size={20} color={colors.fgTertiary} />
                </View>
              )}
              <View className="flex-1" style={{ minWidth: 0 }}>
                <Text className="font-sans-semi text-body" style={{ color: colors.fg }} numberOfLines={2}>
                  {preview?.title ?? share.title ?? host}
                </Text>
                <Text className="font-sans text-sm mt-0.5" style={{ color: colors.fgTertiary }} numberOfLines={1}>
                  {preview?.site ?? host}
                </Text>
              </View>
            </Surface>
          ) : null}

          {keeping ? (
            <View className="flex-row items-center">
              <ActivityIndicator color={colors.accent} />
              <Text className="font-sans text-sm ml-2" style={{ color: colors.fgTertiary }}>
                Keeping {share.photos.length === 1 ? 'the photo' : `${share.photos.length} photos`}…
              </Text>
            </View>
          ) : photos.length > 0 ? (
            <View className="flex-row flex-wrap gap-2">
              {photos.map((p, i) => (
                <Image key={i} source={{ uri: imageUri(p) }} style={{ width: 96, height: 96, borderRadius: 12 }} />
              ))}
            </View>
          ) : null}

          {text ? (
            <View>
              <Eyebrow className="mb-2">Shared text</Eyebrow>
              <TextInput
                value={text}
                onChangeText={setText}
                multiline
                accessibilityLabel="Shared text"
                selectionColor={colors.accent}
                className="font-sans text-body rounded-sm p-3"
                style={[{ color: colors.fg, maxHeight: 200 }, surface, noFocusRing]}
              />
            </View>
          ) : null}

          <View>
            <Eyebrow className="mb-2">Your note</Eyebrow>
            <TextInput
              value={note}
              onChangeText={setNote}
              multiline
              autoFocus={!text}
              placeholder="Why keep this? (optional)"
              placeholderTextColor={colors.fgTertiary}
              accessibilityLabel="Your note"
              selectionColor={colors.accent}
              className="font-sans text-body rounded-sm p-3"
              style={[{ color: colors.fg, minHeight: 72 }, surface, noFocusRing]}
            />
          </View>

          <View>
            <Eyebrow className="mb-2">Goes to</Eyebrow>
            <View className="flex-row flex-wrap gap-2">
              {[{ id: null as string | null, title: 'A new thread' }, ...choices.map((c) => ({ id: c.id as string | null, title: c.title }))].map(
                (c) => {
                  const on = threadId === c.id;
                  return (
                    <Pill
                      key={c.id ?? 'new'}
                      size="lg"
                      soft
                      tone={colors.accent}
                      icon={c.id === null ? 'plus' : c.id === store.focusThreadId ? 'pin' : undefined}
                      selected={on}
                      onPress={() => setThreadId(c.id)}
                    >
                      {c.title}
                    </Pill>
                  );
                },
              )}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoid>
    </View>
  );
}
