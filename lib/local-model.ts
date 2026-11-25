import { sha256 } from '@noble/hashes/sha2.js';
import { Directory, DownloadTask, File, Paths } from 'expo-file-system';
import { getPreferences } from '@/lib/preferences';
import { trace } from '@/lib/trace';
import { createValueStore } from '@/lib/value-store';

// The on-device model file: downloaded only when the person asks (Settings → How Mnemo thinks),
// into the app's own storage, and kept only if its size and SHA-256 are exactly these. Nothing
// else is sent anywhere: the download is a plain GET of a public file.

export type LocalModelSize = 'small' | 'better';

export const LOCAL_MODELS: Record<LocalModelSize, { label: string; name: string; url: string; bytes: number; sha256: string }> = {
  /** Qwen3.5-0.8B (Apache 2.0), Q4_K_M quantisation by Unsloth. */
  small: {
    label: 'Qwen3.5-0.8B',
    name: 'Qwen3.5-0.8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf',
    bytes: 532_517_120,
    sha256: 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517',
  },
  better: {
    label: 'Qwen3.5-2B',
    name: 'Qwen3.5-2B-Q4_K_M.gguf',
    url: 'https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf',
    bytes: 1_280_835_840,
    sha256: 'aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223',
  },
};

export const currentLocalModel = () => LOCAL_MODELS[getPreferences().localModelSize ?? 'small'];

export type LocalModelState =
  | { kind: 'missing' }
  | { kind: 'downloading'; done: number; total: number }
  | { kind: 'checking'; done: number; total: number }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string };

const FOLDER = 'models';
/** Room left over after the model, so the phone isn't filled to the last byte. */
const SPARE_BYTES = 300 * 1024 * 1024;
const HASH_CHUNK = 4 * 1024 * 1024;

const state = createValueStore<LocalModelState>({ kind: 'missing' });
export const useLocalModelState = (): LocalModelState => state.useValue();
export const getLocalModelState = (): LocalModelState => state.get();
export const onLocalModelState = state.subscribe;

function folder(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

const modelFile = (): File => new File(folder(), currentLocalModel().name);
const partFile = (): File => new File(folder(), `${currentLocalModel().name}.part`);

/** The path the engine opens (no file:// scheme). */
export function localModelPath(): string {
  return decodeURI(modelFile().uri.replace(/^file:\/\//, ''));
}

/** Reads what is on the phone. Only a file of the exact size counts; it was hash-checked when it arrived. */
export function refreshLocalModel(fresh = false): LocalModelState {
  const current = state.get();
  if (current.kind === 'downloading' || current.kind === 'checking') return current;
  const { bytes } = currentLocalModel();
  try {
    const file = modelFile();
    const next: LocalModelState = file.exists && file.size === bytes ? { kind: 'ready' } : { kind: 'missing' };
    if (fresh || current.kind !== 'failed' || next.kind === 'ready') state.set(next);
  } catch {
    state.set({ kind: 'missing' });
  }
  return state.get();
}

export const localModelReady = (): boolean => refreshLocalModel().kind === 'ready';

let task: DownloadTask | null = null;

async function hashOf(file: File, total: number): Promise<string> {
  const hash = sha256.create();
  const handle = file.open();
  try {
    let done = 0;
    for (;;) {
      const bytes = handle.readBytes(HASH_CHUNK);
      if (bytes.length === 0) break;
      hash.update(bytes);
      done += bytes.length;
      state.set({ kind: 'checking', done, total });
      // Lets the screen draw between chunks: hashing half a gigabyte takes a while.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    handle.close();
  }
  return [...hash.digest()].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Downloads and checks the model. Resolves when it is ready or has failed (the state says which). */
export async function downloadLocalModel(): Promise<void> {
  if (task || state.get().kind === 'downloading' || state.get().kind === 'checking') return;
  if (refreshLocalModel().kind === 'ready') return;
  const model = currentLocalModel();
  try {
    if (Paths.availableDiskSpace < model.bytes + SPARE_BYTES) {
      state.set({ kind: 'failed', message: `Needs ${Math.ceil((model.bytes + SPARE_BYTES) / 1e6)} MB free on the phone.` });
      return;
    }
    const part = partFile();
    if (part.exists) part.delete();
    state.set({ kind: 'downloading', done: 0, total: model.bytes });
    trace('local-ai', 'model download started');
    task = new DownloadTask(model.url, part, {
      onProgress: ({ bytesWritten }) => state.set({ kind: 'downloading', done: bytesWritten, total: model.bytes }),
    });
    const got = await task.downloadAsync();
    if (!got) throw new Error('The download stopped.');
    const file = partFile();
    if (file.size !== model.bytes) throw new Error(`The file arrived the wrong size (${file.size} bytes).`);
    const digest = await hashOf(file, model.bytes);
    if (digest !== model.sha256) throw new Error("The file arrived damaged (its checksum didn't match).");
    const final = modelFile();
    if (final.exists) final.delete();
    await file.move(final);
    for (const other of folder().list()) if (other instanceof File && other.name !== model.name) other.delete();
    state.set({ kind: 'ready' });
    trace('local-ai', 'model downloaded and checked', 'ok');
  } catch (e) {
    const cancelled = state.get().kind === 'missing';
    try {
      const part = partFile();
      if (part.exists) part.delete();
    } catch {
      // Removed with the model folder on the next "Remove".
    }
    if (!cancelled) {
      const message = String((e as Error)?.message ?? e).slice(0, 160);
      state.set({ kind: 'failed', message: /network|host|connect|timed? ?out|socket/i.test(message) ? 'No connection: try again on Wi-Fi.' : message });
      trace('local-ai', `model download failed: ${message}`, 'error');
    }
  } finally {
    task?.release();
    task = null;
  }
}

export function cancelLocalModelDownload(): void {
  state.set({ kind: 'missing' });
  task?.cancel();
}

/** Deletes the model (and any unfinished download). The engine must be closed first (lib/local-ai.ts closeLocalAi). */
export function removeLocalModel(): void {
  cancelLocalModelDownload();
  try {
    new Directory(Paths.document, FOLDER).delete();
  } catch {
    // Already gone.
  }
  state.set({ kind: 'missing' });
}
