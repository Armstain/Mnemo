import { File } from 'expo-file-system';

// With Gemini on, a voice note's sound is held just long enough for Gemini
// to write it out (it hears Bangla, English and both mixed, which the
// phone's recognizer can't), then deleted. It is never kept with the note.
// Several files when the recognizer restarted mid-note, in order; they
// travel in `pendingAudioUri` one per line.

export function joinAudio(uris: string[]): string | undefined {
  return uris.length > 0 ? uris.join('\n') : undefined;
}

export function splitAudio(joined: string | undefined): string[] {
  return (joined ?? '').split('\n').filter(Boolean);
}

/** The files that are still there (the phone may clear its cache). */
export function existingAudio(uris: string[]): File[] {
  return uris.flatMap((uri) => {
    try {
      const file = new File(uri);
      return file.exists ? [file] : [];
    } catch {
      return [];
    }
  });
}

export function deleteAudio(uris: string[] | string | undefined): void {
  for (const uri of typeof uris === 'string' ? splitAudio(uris) : uris ?? []) {
    try {
      new File(uri).delete();
    } catch {
      // Already gone.
    }
  }
}
