import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

// With Gemini on, a voice note is a recording until Gemini writes it out
// (it hears Bangla, English and both mixed, which the phone's recognizer
// can't). The recording waits in the app's own folder, so the phone
// clearing its cache can't lose a note that's offline, then it's deleted.
// It's never kept with the note. Several recordings ("Record more") travel
// in `pendingAudioUri` one per line, in order.

const FOLDER = 'recordings';

export function joinAudio(uris: string[]): string | undefined {
  return uris.length > 0 ? uris.join('\n') : undefined;
}

export function splitAudio(joined: string | undefined): string[] {
  return (joined ?? '').split('\n').filter(Boolean);
}

/** Moves a just-made recording out of the cache into the app's folder. */
export function keepRecording(tempUri: string): string {
  if (Platform.OS === 'web') return tempUri;
  try {
    const dir = new Directory(Paths.document, FOLDER);
    if (!dir.exists) dir.create({ intermediates: true });
    const from = new File(tempUri);
    const to = new File(dir, `${Date.now()}-${from.name}`);
    from.move(to);
    return to.uri;
  } catch {
    return tempUri;
  }
}

export interface Audio {
  uri: string;
  name: string;
  mimeType: string;
  /** base64 */
  data: string;
}

function mimeOf(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'webm') return 'audio/webm';
  if (ext === 'mp3') return 'audio/mp3';
  if (ext === 'ogg') return 'audio/ogg';
  return 'audio/m4a';
}

async function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** The recordings that are still there, read for sending. */
export async function loadAudio(uris: string[]): Promise<Audio[]> {
  const out: Audio[] = [];
  for (const uri of uris) {
    try {
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        const mimeType = blob.type.split(';')[0] || 'audio/webm';
        out.push({ uri, name: `recording.${mimeType.split('/')[1] ?? 'webm'}`, mimeType, data: await blobBase64(blob) });
        continue;
      }
      const file = new File(uri);
      if (!file.exists) continue;
      out.push({ uri, name: file.name, mimeType: mimeOf(file.name), data: await file.base64() });
    } catch {
      // Gone, or unreadable: skip it.
    }
  }
  return out;
}

export function deleteAudio(uris: string[] | string | undefined): void {
  for (const uri of typeof uris === 'string' ? splitAudio(uris) : uris ?? []) {
    try {
      if (Platform.OS === 'web') URL.revokeObjectURL(uri);
      else new File(uri).delete();
    } catch {
      // Already gone.
    }
  }
}

/** "Clear all data": every recording still waiting. */
export function deleteAllAudio(): void {
  try {
    new Directory(Paths.document, FOLDER).delete();
  } catch {
    // Never existed.
  }
}

/**
 * Deletes recordings no waiting note points at: a note deleted (or its
 * thread) before it was written out leaves its recording behind otherwise.
 */
export function deleteUnusedAudio(waiting: (string | undefined)[]): void {
  if (Platform.OS === 'web') return;
  // By file name: a uri can be spelled more than one way.
  const keep = new Set(waiting.flatMap(splitAudio).map((uri) => decodeURIComponent(uri.split('/').pop() ?? '')));
  try {
    const dir = new Directory(Paths.document, FOLDER);
    if (!dir.exists) return;
    for (const f of dir.list()) if (f instanceof File && !keep.has(f.name)) f.delete();
  } catch {
    // Nothing to tidy.
  }
}
