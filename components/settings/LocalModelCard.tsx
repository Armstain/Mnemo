import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Surface } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Text } from '@/components/ui/Text';
import { ToggleSwitch } from '@/components/ui/ToggleRow';
import { haptic } from '@/lib/haptics';
import { closeLocalAi } from '@/lib/local-ai';
import {
  LOCAL_MODEL,
  cancelLocalModelDownload,
  downloadLocalModel,
  refreshLocalModel,
  removeLocalModel,
  useLocalModelState,
} from '@/lib/local-model';
import { setPreferences, usePreferences } from '@/lib/preferences';
import { confirmAction } from '@/utils/confirm';

const SIZE_MB = Math.round(LOCAL_MODEL.bytes / 1e6);
const percent = (done: number, total: number) => `${Math.min(100, Math.floor((done / Math.max(total, 1)) * 100))}%`;

function startDownload() {
  confirmAction({
    title: 'Download the model?',
    message:
      `${SIZE_MB} MB, once, from Hugging Face (Qwen3.5-0.8B). Best on Wi-Fi. ` +
      'After that it runs on this phone: your notes never leave it.',
    confirmLabel: 'Download',
    cancelLabel: 'Not now',
    onConfirm: () => {
      setPreferences({ localModel: true });
      void downloadLocalModel();
    },
  });
}

/** Settings → How Mnemo thinks → Offline: a small model on the phone that names and tags notes. Android only. */
export function LocalModelCard() {
  const { localModel, aiMode } = usePreferences();
  const state = useLocalModelState();
  useEffect(() => {
    refreshLocalModel();
  }, []);
  if (Platform.OS !== 'android') return null;

  const on = localModel === true;
  const onToggle = (next: boolean) => {
    haptic.toggle(next);
    if (!next) {
      setPreferences({ localModel: false });
      void closeLocalAi();
      return;
    }
    if (refreshLocalModel().kind === 'ready') setPreferences({ localModel: true });
    else startDownload();
  };

  return (
    <Surface tone="soft" className="rounded-lg p-5 gap-3">
      <View className="flex-row items-start" style={{ gap: 12 }}>
        <View className="flex-1">
          <Text className="font-sans-semi text-sm text-fg">Name notes on the phone</Text>
          <Text className="font-sans text-sm text-fg-secondary leading-relaxed mt-1">
            {aiMode === 'gemini'
              ? "When Gemini can't answer (no connection, daily limit), a small AI model on the phone names and tags typed notes until it can."
              : 'A small AI model gives notes short titles and tags, a few seconds after you save them. Slower and simpler than Smart, and nothing leaves your phone.'}
          </Text>
        </View>
        <ToggleSwitch value={on} onValueChange={onToggle} label="Name notes on the phone" />
      </View>

      {state.kind === 'downloading' || state.kind === 'checking' ? (
        <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
          <Text className="font-sans text-sm text-fg-secondary flex-1">
            {state.kind === 'downloading'
              ? `Downloading… ${percent(state.done, state.total)} of ${SIZE_MB} MB`
              : `Checking the file… ${percent(state.done, state.total)}`}
          </Text>
          {state.kind === 'downloading' ? (
            <Button variant="ghost" size="sm" onPress={cancelLocalModelDownload}>
              Cancel
            </Button>
          ) : null}
        </View>
      ) : null}

      {state.kind === 'failed' ? (
        <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
          <Text className="font-sans text-sm text-fg-secondary flex-1">{state.message}</Text>
          <Button variant="quiet" size="sm" onPress={() => void downloadLocalModel()}>
            Try again
          </Button>
        </View>
      ) : null}

      {state.kind === 'ready' ? (
        <View className="flex-row items-center justify-between" style={{ gap: 12 }}>
          <Text className="font-sans text-sm text-fg-secondary flex-1">On this phone · {SIZE_MB} MB</Text>
          <Button
            variant="ghost"
            size="sm"
            onPress={() =>
              confirmAction({
                title: 'Remove the model?',
                message: `Frees ${SIZE_MB} MB. Notes keep the names it gave them; new ones are named by the phone's own reader.`,
                confirmLabel: 'Remove',
                onConfirm: async () => {
                  setPreferences({ localModel: false });
                  await closeLocalAi();
                  removeLocalModel();
                },
              })
            }
          >
            Remove
          </Button>
        </View>
      ) : null}
    </Surface>
  );
}
