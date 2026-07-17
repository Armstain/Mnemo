import { useEffect, useRef } from 'react';
import { File } from 'expo-file-system';
import { useMnemoStore } from '@/hooks/use-mnemo-store';
import { processVoiceDump } from '@/lib/gemini';
import { processRecording } from '@/lib/capture';

/**
 * Invisible component mounted at the app root.
 * On startup it finds any items that were saved while offline and
 * tries to structure them via Gemini once connectivity is available.
 */
export function PendingProcessor() {
  const { items, isLoaded, updateItem } = useMnemoStore();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isLoaded || hasRun.current) return;
    hasRun.current = true;

    const pending = items.filter((c) => c.pending);
    if (pending.length === 0) return;

    for (const item of pending) {
      (async () => {
        try {
          if (item.pendingAudioUri) {
            const audioFile = new File(item.pendingAudioUri);
            if (!audioFile.exists) {
              updateItem(item.id, {
                pending: false,
                pendingAudioUri: undefined,
              });
              return;
            }
            const base64 = await audioFile.base64();
            const processed = await processRecording({
              fileUri: item.pendingAudioUri,
              base64,
              mimeType: 'audio/m4a',
            });
            try { audioFile.delete(); } catch { /* already deleted — safe to ignore */ }
            updateItem(item.id, {
              title: processed.title,
              content: processed.notes,
              links: processed.links,
              aiSummary: processed.summary,
              whereLeftOff: processed.summary?.leftOff,
              nextStep: processed.summary?.nextSteps?.[0],
              pending: false,
              pendingAudioUri: undefined,
              pendingRawText: undefined,
              status: 'active',
            });
          } else if (item.pendingRawText) {
            const processed = await processVoiceDump(item.pendingRawText);
            updateItem(item.id, {
              title: processed.title,
              content: processed.notes,
              links: processed.links,
              aiSummary: processed.summary,
              whereLeftOff: processed.summary?.leftOff,
              nextStep: processed.summary?.nextSteps?.[0],
              pending: false,
              pendingRawText: undefined,
              status: 'active',
            });
          }
        } catch {
          // Keep the item as pending — will retry next launch.
        }
      })();
    }
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
