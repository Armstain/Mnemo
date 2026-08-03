import { GoogleGenAI, Modality, Type, type GenerateContentParameters } from '@google/genai';

const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || "";

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Newest models this key can access with a free-tier quota
// (verified against the live /v1beta/models listing, July 2026).
// gemini-3.5-flash hits "high demand" errors on the free tier at peak
// times, so text calls fall back to the previous flash automatically.
const TEXT_MODELS = ['gemini-3.5-flash', 'gemini-3-flash-preview'];
const TTS_MODEL = 'gemini-3.1-flash-tts-preview';

async function generateText(params: Omit<GenerateContentParameters, 'model'>) {
  let lastError: unknown;
  for (const model of TEXT_MODELS) {
    try {
      return await ai.models.generateContent({ model, ...params });
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

const DUMP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
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
  },
  required: ['title', 'notes', 'links', 'tags', 'suggestedCategory', 'summary'],
};

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

export async function processVoiceDump(transcript: string) {
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
      }
    }
  `;

  const response = await generateText({
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: DUMP_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) throw new Error('Failed to process voice dump');
  return JSON.parse(text);
}

export async function generateSpeech(text: string) {
  try {
    const response = await ai.models.generateContent({
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

export async function processAudioDump(base64Audio: string, mimeType: string) {
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
      }
    }
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
      responseSchema: DUMP_SCHEMA,
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
