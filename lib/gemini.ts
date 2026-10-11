import { GoogleGenAI, Modality, Type, type GenerateContentParameters } from '@google/genai';
import { getActiveApiKey } from './api-key';

export function getAIClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: getActiveApiKey() });
}

export const ai = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    const client = getAIClient();
    const value = (client as any)[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

// Latest Gemini 3 series models (August 2026).
// gemini-3.6-flash is the primary model for agentic and text processing,
// with gemini-3.5-flash and gemini-3.1-flash as reliable fallbacks.
const TEXT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash'];
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

async function generateText(params: Omit<GenerateContentParameters, 'model'>) {
  let lastError: unknown;
  const client = getAIClient();
  for (const model of TEXT_MODELS) {
    try {
      return await client.models.generateContent({ model, ...params });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/** Category list for AI suggestion. */
const VALID_CATEGORIES = ['work', 'personal', 'study', 'shopping', 'health', 'ideas', 'errands', 'general'];

// ─── Response schemas ───────────────────────────────────────────
// Every structured call declares a schema so a malformed model
// response fails at the API layer instead of at JSON.parse.

const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    leftOff: {
      type: Type.STRING,
      description: 'Summary of where the user left off',
    },
    nextSteps: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'List of actionable next steps',
    },
    resources: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          url: { type: Type.STRING },
        },
        required: ['name', 'url'],
      },
      description: 'List of key resources with names and URLs',
    },
  },
  required: ['leftOff', 'nextSteps', 'resources'],
};

const ROLLUPS = ['sum', 'latest', 'average', 'compare'];

const DUMP_PROPERTIES = {
  title: { type: Type.STRING, description: 'Short punchy title (max 5 words)' },
  notes: { type: Type.STRING, description: 'Cleaned up, well-formatted notes' },
  links: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: 'URLs mentioned in the note',
  },
  tags: {
    type: Type.ARRAY,
    items: { type: Type.STRING },
    description: '2-5 short lowercase keyword tags capturing the topic (e.g. "passport", "travel", "recipe"). No hashtags, no categories already covered by suggestedCategory.',
  },
  suggestedCategory: { type: Type.STRING, enum: VALID_CATEGORIES },
  summary: SUMMARY_SCHEMA,
  measures: {
    type: Type.ARRAY,
    description: 'Numbers the person reports that are worth tracking. Empty if none.',
    items: {
      type: Type.OBJECT,
      properties: {
        metric: { type: Type.STRING },
        value: { type: Type.NUMBER },
        unit: { type: Type.STRING },
        label: { type: Type.STRING },
        group: { type: Type.STRING },
        rollup: { type: Type.STRING, enum: ROLLUPS },
      },
      required: ['metric', 'value', 'unit', 'label', 'group', 'rollup'],
    },
  },
};

const THREAD_MATCH_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    match: { type: Type.STRING, enum: ['existing', 'new'] },
    threadId: { type: Type.STRING },
    confidence: { type: Type.NUMBER },
    reason: { type: Type.STRING },
  },
  required: ['match', 'threadId', 'confidence', 'reason'],
};

const DUMP_REQUIRED = ['title', 'notes', 'links', 'tags', 'suggestedCategory', 'summary', 'measures'];

/** The capture schema; thread matching and a transcript only when asked for. */
function dumpSchema(opts: { threads: boolean; transcript: boolean }) {
  const properties: Record<string, unknown> = { ...DUMP_PROPERTIES };
  const required = [...DUMP_REQUIRED];
  if (opts.transcript) {
    properties.transcript = {
      type: Type.STRING,
      description: 'Faithful word-for-word transcript, numbers written as digits',
    };
    required.push('transcript');
  }
  if (opts.threads) {
    properties.thread = THREAD_MATCH_SCHEMA;
    required.push('thread');
  }
  return { type: Type.OBJECT, properties, required };
}

/** An open thread a new capture might belong to (see lib/filing.ts). */
export interface ThreadCandidate {
  id: string;
  title: string;
  category: string;
  nextStep?: string;
  /** A snippet of its newest entry. */
  latest?: string;
  /** The thread the person chose to send quick captures to. */
  focused?: boolean;
  /** What it already tracks, e.g. "spent (EUR, sum)". */
  tracks?: string[];
  /** Whole days since anything was added. */
  idleDays?: number;
}

export interface CaptureContext {
  /** Open threads this capture might belong to (quick captures only). */
  candidates: ThreadCandidate[];
  /** What the thread it's going into already tracks, so names are reused. */
  tracks?: string[];
}

export interface ThreadMatch {
  match: 'existing' | 'new';
  threadId: string;
  confidence: number;
  reason: string;
}

/** What one capture call returns. `measures` is unchecked: see verifyMeasures. */
export interface ProcessedCapture {
  title: string;
  notes: string;
  links: string[];
  tags?: string[];
  suggestedCategory?: string;
  summary?: { leftOff: string; nextSteps: string[]; resources: { name: string; url: string }[] };
  measures?: unknown[];
  transcript?: string;
  thread?: ThreadMatch;
}

const MEASURE_RULES = `
MEASURES ("measures"):
Numbers the person reports about their life that they'd want to add up or follow over time: money spent, distance, weight, hours slept or studied, pages read, reps, counts, scores, prices of options they're comparing.
- Never: dates, times of day, years, ages in passing, phone numbers, addresses, ids, ordinals, or numbers that are only part of a name.
- "metric": short and stable, e.g. "spent", "ran", "weight", "sleep", "studied", "price". Reuse an existing name when one is listed below.
- "value": the number exactly as they said it. Never estimate, convert units or currencies, add numbers up or split them.
- "unit": ISO currency code for money when they named or clearly meant one (euros → EUR, taka → BDT, rupees → INR); otherwise the unit they used ("km", "kg", "h", "pages"), or "".
- "label": 1-4 words for what this one was ("dinner", "morning run"), or "".
- "group": a broad bucket to break totals down by ("food", "transport", "stay"), or "".
- "rollup": how values of this metric combine. "sum" for amounts that add up (spending, distance, hours worked). "latest" for a level that changes (body weight, balance, progress). "average" for a rating or recurring reading (sleep, mood). "compare" for options being weighed (prices of laptops, rents).
- If there is nothing to track, return [].`;

function trackRules(ctx?: CaptureContext): string {
  const tracks = [...new Set([...(ctx?.tracks ?? []), ...(ctx?.candidates ?? []).flatMap((c) => c.tracks ?? [])])];
  return tracks.length > 0 ? `Already tracked (reuse these names and units): ${tracks.join('; ')}.` : '';
}

function idleText(days?: number): string {
  if (!days) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

function threadRules(ctx?: CaptureContext): string {
  if (!ctx || ctx.candidates.length === 0) return '';
  const list = ctx.candidates
    .map((c) => {
      const parts = [`id=${c.id}`, `"${c.title}"`, c.category, `last update: ${idleText(c.idleDays)}`];
      if (c.nextStep) parts.push(`next: ${c.nextStep}`);
      if (c.latest) parts.push(`latest: ${c.latest}`);
      if (c.tracks?.length) parts.push(`tracks: ${c.tracks.join(', ')}`);
      return `- ${parts.join(' · ')}${c.focused ? '  ← FOCUSED: they chose to send quick notes here' : ''}`;
    })
    .join('\n');
  return `
THREAD ("thread"):
Today is ${new Date().toDateString()}. The person has these ongoing threads in their life:
${list}

Decide whether this capture continues one of them: the same trip, task, project, purchase or person, not merely a similar topic.
- "match": "existing" with that thread's exact id, or "new" with threadId "".
- A quick update, expense or reading made during a trip, project or routine belongs to it when it plausibly happened as part of it.
- If a thread is FOCUSED, choose it for anything plausibly related to it; answer "new" only when the capture is clearly about something else.
- Time matters. A trip, event or project with no update for weeks is probably over: a routine update (an expense, a reading, an errand) now belongs to a new thread, unless the capture names that thread or clearly refers back to it.
- "confidence": 0 to 1, how sure you are it belongs there (not how similar the words are).
- "reason": one short line they will read, e.g. "Sounds like part of your Lisbon trip".`;
}

const ENHANCE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestedTitle: { type: Type.STRING },
    suggestedCategory: { type: Type.STRING, enum: VALID_CATEGORIES },
    whereLeftOff: { type: Type.STRING },
    nextStep: { type: Type.STRING },
    summary: SUMMARY_SCHEMA,
  },
  required: ['suggestedTitle', 'suggestedCategory', 'whereLeftOff', 'nextStep', 'summary'],
};

export async function summarizeContext(notes: string, links: string[]) {
  const prompt = `
You are an expert productivity assistant. A user is returning to a task after being away.
They left the following notes and links before they left.

Notes:
${notes}

Links:
${links.join('\n')}

Analyze this context and provide a crisp summary to help them re-orient immediately.
IMPORTANT: Detect the language of the notes and provide the entire analysis (leftOff, nextSteps, resources) in that SAME language.
Return the result as a JSON object with the following structure:
{
  "leftOff": "A short paragraph summarizing exactly where they left off.",
  "nextSteps": ["Actionable step 1", "Actionable step 2", ...],
  "resources": [{"name": "Resource Name", "url": "URL if available, otherwise a search query link like https://www.google.com/search?q=..."}]
}
`;

  try {
    const response = await generateText({
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: SUMMARY_SCHEMA,
      },
    });

    if (response.text) {
      return JSON.parse(response.text);
    }
    throw new Error('No response text');
  } catch (error) {
    console.error('Error summarizing context:', error);
    throw error;
  }
}

export async function generateTitle(notes: string) {
  const prompt = `Generate a short, concise title (max 5 words) for the following task notes:\n\n${notes}`;
  try {
    const response = await generateText({
      contents: prompt,
    });
    return response.text?.trim() || 'Untitled Task';
  } catch (error) {
    console.error('Error generating title:', error);
    return 'Untitled Task';
  }
}

export async function processVoiceDump(
  transcript: string,
  ctx?: CaptureContext,
): Promise<ProcessedCapture> {
  const prompt = `
    You are an expert productivity assistant. The user just captured a thought — it could be about anything in their life: work, errands, shopping, study, health, ideas, or personal matters.
    
    Raw text:
    "${transcript}"

    Understand the context, fix any errors, and structure this into a clean JSON object.
    IMPORTANT: Detect the language and provide the entire analysis in that SAME language.
    
    Also suggest the best category from this list: ${VALID_CATEGORIES.join(', ')}
    
    Format:
    {
      "title": "Short punchy title (max 5 words)",
      "notes": "Cleaned up, well-formatted version of their notes. Fix grammar and make it readable, but keep all details.",
      "links": ["Extract any URLs or links mentioned. If none, empty array."],
      "tags": ["2-5 short lowercase keyword tags for the topic, e.g. passport, travel"],
      "suggestedCategory": "one of: ${VALID_CATEGORIES.join(', ')}",
      "summary": {
        "leftOff": "1-2 sentences on exactly where they left off",
        "nextSteps": ["Actionable step 1", "Actionable step 2"],
        "resources": [{"name": "Relevant resource 1", "url": "URL or search link"}]
      },
      "measures": [{"metric": "spent", "value": 40, "unit": "EUR", "label": "dinner", "group": "food", "rollup": "sum"}]
    }
    ${MEASURE_RULES}
    ${trackRules(ctx)}
    ${threadRules(ctx)}
  `;

  const response = await generateText({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: dumpSchema({ threads: !!ctx?.candidates.length, transcript: false }),
    },
  });

  const text = response.text;
  if (!text) throw new Error('Failed to process voice dump');
  return JSON.parse(text);
}

export async function generateSpeech(text: string) {
  try {
    const client = getAIClient();
    const response = await client.models.generateContent({
      model: TTS_MODEL,
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Zephyr' },
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error('Failed to generate speech');
    return base64Audio;
  } catch (error) {
    console.error('Error generating speech:', error);
    throw error;
  }
}

export async function processAudioDump(
  base64Audio: string,
  mimeType: string,
  ctx?: CaptureContext,
): Promise<ProcessedCapture> {
  const prompt = `
    You are an expert productivity assistant. The user just recorded a voice thought about something in their life — it could be work, errands, shopping, study, health, ideas, or personal matters.
    
    TRANSCRIPTION & ANALYSIS TASK:
    1. Transcribe the audio precisely.
    2. Detect the language of the speaker.
    3. Generate a structured analysis in the SAME language as the speaker.
    4. Suggest the best category from this list: ${VALID_CATEGORIES.join(', ')}
    
    Return a clean JSON object:
    {
      "title": "Short punchy title (max 5 words) in the speaker's language",
      "notes": "Clean, well-formatted transcription/expanded notes in the speaker's language.",
      "links": ["Extract any URLs or links mentioned. If none, empty array."],
      "tags": ["2-5 short lowercase keyword tags for the topic, in the speaker's language"],
      "suggestedCategory": "one of: ${VALID_CATEGORIES.join(', ')}",
      "summary": {
        "leftOff": "1-2 sentences on exactly where they left off in the speaker's language",
        "nextSteps": ["Actionable steps in the speaker's language"],
        "resources": [{"name": "Relevant resources mentioned in the speaker's language", "url": "URL or search link"}]
      },
      "transcript": "Word-for-word transcript, with numbers written as digits",
      "measures": [{"metric": "spent", "value": 40, "unit": "EUR", "label": "dinner", "group": "food", "rollup": "sum"}]
    }
    ${MEASURE_RULES}
    ${trackRules(ctx)}
    ${threadRules(ctx)}
  `;

  const response = await generateText({
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType, data: base64Audio } }
        ]
      }
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: dumpSchema({ threads: !!ctx?.candidates.length, transcript: true }),
    },
  });

  const text = response.text;
  if (!text) throw new Error('Failed to process audio dump');
  return JSON.parse(text);
}

/**
 * Enhance an existing item with AI suggestions.
 * Returns suggested improvements without modifying the original.
 */
export async function enhanceItem(title: string, content: string, category: string) {
  const prompt = `
    You are an expert productivity assistant. The user has an existing item in their Personal Continuity App.
    
    Title: "${title}"
    Content: "${content}"
    Category: ${category}
    
    Analyze this item and suggest improvements. Detect the language and respond in the SAME language.
    
    Return a JSON object:
    {
      "suggestedTitle": "A cleaner, more descriptive title if the current one is vague (otherwise return the same title)",
      "suggestedCategory": "one of: ${VALID_CATEGORIES.join(', ')}",
      "whereLeftOff": "1-2 sentences summarizing where they seem to be",
      "nextStep": "The single most important next action",
      "summary": {
        "leftOff": "Summary of current state",
        "nextSteps": ["Actionable step 1", "Actionable step 2"],
        "resources": [{"name": "Resource name", "url": "URL or search link"}]
      }
    }
  `;

  const response = await generateText({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: ENHANCE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Failed to enhance item');
  return JSON.parse(text);
}

/**
 * Write a short spoken briefing to read aloud when the user resumes an item.
 * Returns plain prose (no markdown) in the same language as the note.
 */
export async function generateRebriefScript(input: {
  title: string;
  timeAway: string;
  whereLeftOff?: string;
  nextSteps?: string[];
}) {
  const prompt = `
You are the voice of Mnemo, a personal continuity app. The user is about to resume something they stepped away from. Write a short spoken briefing that gets them back into it.

Task: "${input.title}"
Time away: ${input.timeAway}
${input.whereLeftOff ? `Where they left off: ${input.whereLeftOff}` : ''}
${input.nextSteps?.length ? `Next steps:\n${input.nextSteps.map((s) => `- ${s}`).join('\n')}` : ''}

Rules:
- Speak directly to the user — warm, brisk, like a trusted chief of staff.
- 40 to 70 words. Plain sentences only: it will be read aloud, so no markdown, lists, headings, or emojis.
- End with the single most important next action.
- Write in the same language as the task notes above.
`;

  const response = await generateText({
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) throw new Error('Failed to generate re-brief script');
  return text;
}
