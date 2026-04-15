import { useEffect, useRef } from 'react';
import { File } from 'expo-file-system';
import { useContextStore } from '@/hooks/use-context-store';
import { processAudioDump, processVoiceDump } from '@/lib/gemini';

/**
 * Invisible component mounted at the app root.
 * On startup it finds any notes that were saved while offline and
 * tries to structure them via Gemini once connectivity is available.
 */
export function PendingProcessor() {
  const { contexts, isLoaded, updateContext } = useContextStore();
  const hasRun = useRef(false);

  useEffect(() => {
    if (!isLoaded || hasRun.current) return;
    hasRun.current = true;

    const pending = contexts.filter((c) => c.pending);
    if (pending.length === 0) return;

    for (const ctx of pending) {
      (async () => {
        try {
          if (ctx.pendingAudioUri) {
            const audioFile = new File(ctx.pendingAudioUri);
            if (!audioFile.exists) {
              updateContext(ctx.id, {
                pending: false,
                pendingAudioUri: undefined,
              });
              return;
            }
            const base64 = await audioFile.base64();
            const processed = await processAudioDump(base64, 'audio/m4a');
            try { audioFile.delete(); } catch { /* already deleted — safe to ignore */ }
            updateContext(ctx.id, {
              title: processed.title,
              notes: processed.notes,
              links: processed.links,
              summary: processed.summary,
              pending: false,
              pendingAudioUri: undefined,
              pendingRawText: undefined,
            });
          } else if (ctx.pendingRawText) {
            const processed = await processVoiceDump(ctx.pendingRawText);
            updateContext(ctx.id, {
              title: processed.title,
              notes: processed.notes,
              links: processed.links,
              summary: processed.summary,
              pending: false,
              pendingRawText: undefined,
            });
          }
        } catch {
          // Keep the note as pending — will retry next launch.
        }
      })();
    }
  }, [isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
