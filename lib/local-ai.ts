import { Platform } from 'react-native';
import type { LlamaContext } from 'llama.rn';
import { LOCAL_SCHEMA, LOCAL_SYSTEM, localPrompt, readLocalAnswer, type LocalReading } from '@/lib/local-prompt';
import { localModelPath, localModelReady } from '@/lib/local-model';
import { getPreferences } from '@/lib/preferences';
import { begin } from '@/lib/trace';

// The on-device model (llama.cpp through llama.rn): opened when a note needs it, run one note
// at a time, and closed again after a quiet minute so its ~1 GB of memory goes back to the phone.

/** Room for the system prompt, a note cut to LOCAL_MAX_NOTE_CHARS and the answer. */
const CONTEXT_TOKENS = 2048;
const ANSWER_TOKENS = 160;
/** Measured: higher and the 0.8B model starts drifting from the note's own words. */
const TEMPERATURE = 0.1;
const CLOSE_AFTER_MS = 60_000;

let context: Promise<LlamaContext> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** True when notes should be read by the on-device model: offline, turned on, and the model is on the phone. */
export function localAiEnabled(): boolean {
  const prefs = getPreferences();
  return Platform.OS === 'android' && prefs.aiMode !== 'gemini' && prefs.localModel === true && localModelReady();
}

async function open(): Promise<LlamaContext> {
  if (!context) {
    context = (async () => {
      const { initLlama } = await import('llama.rn');
      return initLlama({ model: localModelPath(), n_ctx: CONTEXT_TOKENS, n_gpu_layers: 0, use_mlock: false });
    })();
    context.catch(() => {
      context = null;
    });
  }
  return context;
}

function scheduleClose(): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => void closeLocalAi(), CLOSE_AFTER_MS);
}

/** Frees the model's memory. Safe to call at any time; the next note opens it again. */
export async function closeLocalAi(): Promise<void> {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = null;
  const open = context;
  context = null;
  if (!open) return;
  try {
    await (await open).release();
  } catch {
    // Never opened, or already released.
  }
}

/** One note at a time: the model is single-threaded and a second note would only wait inside it. */
function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

/** Names, sorts and tags a note on the phone. Null when the model had nothing usable to say; throws if it couldn't run. */
export function readNoteLocally(note: string, topic: string): Promise<LocalReading | null> {
  return serial(async () => {
    const done = begin(topic, 'on-device model reading it');
    try {
      const llama = await open();
      const result = await llama.completion({
        messages: [
          { role: 'system', content: LOCAL_SYSTEM },
          { role: 'user', content: localPrompt(note) },
        ],
        response_format: { type: 'json_schema', json_schema: { strict: true, schema: LOCAL_SCHEMA } },
        enable_thinking: false,
        n_predict: ANSWER_TOKENS,
        temperature: TEMPERATURE,
      });
      const reading = readLocalAnswer(result.content || result.text, note);
      done(reading ? 'ok' : 'warn', reading ? `${reading.title ?? '(no title)'} · ${reading.tags.join(', ')}` : 'nothing usable');
      return reading;
    } catch (e) {
      done('error', String((e as Error)?.message ?? e).slice(0, 120));
      throw e;
    } finally {
      scheduleClose();
    }
  });
}
