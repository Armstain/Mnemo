import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorText, classifyAiError } from '@/lib/api-key';
import { describeEmpty, EmptyResponseError, emptyKindOf, topSafety } from '@/lib/empty-response';
import { processAudioDump, processVoiceDump } from '@/lib/gemini';

// A pretend Google: two flash models and a lite; only the best flash and the lite are used.
const calls = vi.hoisted(() => [] as string[]);
// The config each request was sent with.
const configs = vi.hoisted(() => [] as Record<string, unknown>[]);
const behaviour = vi.hoisted(() => new Map<string, () => unknown>());

vi.mock('expo-secure-store', () => ({}));
vi.mock('@google/genai', () => ({
  Type: new Proxy({}, { get: (_t, k) => String(k) }),
  Modality: new Proxy({}, { get: (_t, k) => String(k) }),
  GoogleGenAI: class {
    models = {
      list: async () =>
        (async function* () {
          for (const name of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'])
            yield { name: `models/${name}`, supportedActions: ['generateContent'] };
        })(),
      generateContent: async ({ model, config }: { model: string; config: Record<string, unknown> }) => {
        calls.push(model);
        configs.push(config);
        return (behaviour.get(model) ?? valid)();
      },
    };
  },
}));
vi.mock('@/lib/api-key', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-key')>()),
  getActiveApiKey: () => 'key',
}));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true, setAiNotice: () => {} }));
vi.mock('@/lib/link-preview', () => ({ describePages: () => '' }));

const NOTE = { title: 'Plumber', notes: 'Call the plumber', links: [], tags: [], suggestedCategory: 'errands', summary: { leftOff: 'x', nextSteps: [], resources: [] } };
const valid = () => ({ text: JSON.stringify(NOTE) });
const empty = () => ({ text: undefined, candidates: [{ finishReason: 'STOP' }] });
const truncated = () => ({ text: '', candidates: [{ finishReason: 'MAX_TOKENS' }] });
const safety = () => ({ text: undefined, candidates: [{ finishReason: 'SAFETY' }], promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } });
// What the phone saw for "Remind me when I get to Eastern": blocked at the
// prompt, no candidates, and the ratings saying which category fired.
const rated = () => ({
  text: undefined,
  candidates: [],
  promptFeedback: {
    blockReason: 'PROHIBITED_CONTENT',
    safetyRatings: [
      { category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'LOW' },
    ],
  },
});

const cutOff = () => ({ text: '{"title":"Plumber","notes":"Call the', candidates: [{ finishReason: 'MAX_TOKENS' }] });

describe('an answer that has text but not the JSON asked for', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour.clear();
  });

  it('is no success either: the next model answers (it used to throw at JSON.parse, with no fallback)', async () => {
    behaviour.set('gemini-3-flash-preview', cutOff);
    const note = await processVoiceDump('call the plumber');
    expect(note.title).toBe('Plumber');
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash-lite']);
  });

  it('cut off everywhere: says it was cut off, with the finishReason', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, cutOff);
    const error = await processVoiceDump('call the plumber').catch((e) => e);
    expect(error.message).toContain('MAX_TOKENS');
    expect(error.message).toContain('unreadable');
    expect(classifyAiError(error)).toBe('truncated');
  });
});

describe('an answer with no text', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour.clear();
  });

  it('is no success: the next model answers, and its text is used', async () => {
    behaviour.set('gemini-3-flash-preview', empty);
    const note = await processVoiceDump('call the plumber');
    expect(note.title).toBe('Plumber');
    // One Flash only: older Flash names often share its quota.
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash-lite']);
  });

  it('empty everywhere: each model is asked once (no second pass), then says why', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, truncated);
    const error = await processVoiceDump('call the plumber').catch((e) => e);
    expect(calls).toHaveLength(2);
    expect(error.message).toContain('MAX_TOKENS');
    expect(emptyKindOf(error)).toBe('truncated');
    expect(classifyAiError(error)).toBe('truncated');
  });

  it('a safety block names its finishReason, blockReason, candidates, model and input, and is not asked again', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, safety);
    const error = await processVoiceDump('call the plumber').catch((e) => e);
    expect(calls).toHaveLength(1); // a block is about the content: no other model is asked
    expect(error.message).toContain('finish=SAFETY');
    expect(error.message).toContain('block=PROHIBITED_CONTENT');
    expect(error.message).toContain('candidates=1');
    expect(error.message).toContain('gemini-3-flash-preview');
    expect(error.message).toContain('transcript 16 chars');
    expect(classifyAiError(error)).toBe('blocked');
    expect(aiErrorText(error)).toMatch(/safety filter/);
  });

  it('a recording is described by its size, and a blank note is "empty input"', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, safety);
    const audio = await processAudioDump([{ data: 'AAAA'.repeat(1024), mimeType: 'audio/mp4' }]).catch((e) => e);
    expect(audio.message).toMatch(/audio 1 recording, 3 KB/);
    expect(audio.message).toContain('finish=SAFETY');

    behaviour.clear();
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, empty);
    const blank = await processVoiceDump('   ').catch((e) => e);
    expect(emptyKindOf(blank)).toBe('empty-input');
    expect(classifyAiError(blank)).toBe('empty');
  });

  it('counts in the message are not taken for status codes', () => {
    expect(classifyAiError(new Error('Gemini returned no text (empty) · input: transcript 429 chars · gemini-2.5-flash finish=STOP candidates=1'))).toBe('empty');
  });
});

describe('which safety category fired', () => {
  beforeEach(() => {
    calls.length = 0;
    configs.length = 0;
    behaviour.clear();
  });

  it('a block names the category and its probability, right after the cause', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, rated);
    const error = await processVoiceDump('Remind me when I get to Eastern').catch((e) => e);
    expect(error.message).toMatch(/^The model returned no text \(blocked\) · safety=HARM_CATEGORY_DANGEROUS_CONTENT:HIGH · input: transcript 31 chars · /);
    expect(error.message).toContain('block=PROHIBITED_CONTENT candidates=0');
    expect(emptyKindOf(error)).toBe('blocked');
    expect(classifyAiError(error)).toBe('blocked');
  });

  it("reads a candidate's ratings too, and prefers the one Google marks as the blocker", () => {
    const a = describeEmpty(
      {
        candidates: [{ finishReason: 'SAFETY', safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' }, { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'MEDIUM', blocked: true }] }],
      },
      'gemini-2.5-flash',
    );
    expect(a.safety).toHaveLength(2);
    expect(topSafety([a])).toEqual({ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'MEDIUM', blocked: true });
    expect(new EmptyResponseError([a]).message).toContain('safety=HARM_CATEGORY_DANGEROUS_CONTENT:MEDIUM');
  });

  it('no ratings, or not a block: nothing about safety in the message', () => {
    expect(new EmptyResponseError([describeEmpty({ promptFeedback: { blockReason: 'OTHER' } }, 'm')]).message).not.toContain('safety=');
    expect(new EmptyResponseError([describeEmpty({ candidates: [{ finishReason: 'MAX_TOKENS' }] }, 'm')]).message).not.toContain('safety=');
  });

  it('every request asks to block only HIGH in the four adjustable categories, and never turns one off', async () => {
    await processVoiceDump('call the plumber');
    expect(configs[0].safetySettings).toEqual([
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ]);
    expect(JSON.stringify(configs)).not.toMatch(/BLOCK_NONE|"OFF"|CIVIC_INTEGRITY/);
    // The rest of the config is the caller's, as before.
    expect(configs[0].responseMimeType).toBe('application/json');
    expect(configs[0].httpOptions).toEqual({ timeout: 90_000 });
  });
});
