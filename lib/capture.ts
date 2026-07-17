import { processAudioDump, processVoiceDump } from '@/lib/gemini';
import { transcribeAudio } from '@/lib/groq';
import type { AISummary } from '@/types/mnemo';

export interface ProcessedRecording {
  title: string;
  notes: string;
  links: string[];
  suggestedCategory?: string;
  summary?: AISummary;
}

/**
 * Turn a voice recording into a structured note, degrading gracefully:
 * 1. Gemini audio understanding (transcribe + structure in one call).
 * 2. Groq Whisper transcript, structured by Gemini text.
 * 3. Groq Whisper transcript as-is — a raw note beats a lost one.
 * Throws only when every provider is unreachable; callers keep their
 * offline "process later" path for that case.
 */
export async function processRecording(input: {
  fileUri: string;
  base64: string;
  mimeType: string;
}): Promise<ProcessedRecording> {
  try {
    return await processAudioDump(input.base64, input.mimeType);
  } catch {
    const transcript = await transcribeAudio(input.fileUri, input.mimeType);
    try {
      return await processVoiceDump(transcript);
    } catch {
      const words = transcript.split(/\s+/);
      return {
        title: words.slice(0, 5).join(' ') + (words.length > 5 ? '…' : ''),
        notes: transcript,
        links: [],
      };
    }
  }
}
