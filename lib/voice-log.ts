import { diagnosticLog } from '@/lib/place-log';

// What happened to voice notes, for the problem report (lib/errors.ts): how each one was taken
// (recorded for Gemini, or heard by the phone), how it ended (words heard, the recognizer's own
// errors, a recording cut short or lost) and how it was written out. Counts and codes only:
// never the words, never the audio.

const voiceLog = diagnosticLog('mnemo-voice-log');
export const readVoiceLog = voiceLog.read;
export const noteVoice = voiceLog.note;

/** "12 s" / "1 min 5 s". */
export function seconds(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** A word count, so the log says how much was heard without saying what. */
export const wordCount = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** For the problem report: how voice notes are taken now, and what happened to the last ones. Counts and codes only. */
export async function voiceReport(): Promise<string> {
  try {
    const { aiEnabled } = await import('@/lib/ai-mode');
    const { getPreferences } = await import('@/lib/preferences');
    const { logLines } = await import('@/lib/place-log');
    const how = aiEnabled() ? 'recorded, written out by Gemini' : `heard by the phone (${getPreferences().speechLang})`;
    const log = logLines(await readVoiceLog());
    return `Voice notes: ${how}\nVoice log (last ${log.length}): ${log.length ? `\n${log.join('\n')}` : 'empty'}`;
  } catch {
    return 'Voice: unreadable';
  }
}
