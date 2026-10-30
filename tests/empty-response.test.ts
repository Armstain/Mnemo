import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aiErrorText, classifyAiError } from '@/lib/api-key';
import { emptyKindOf } from '@/lib/empty-response';
import { processAudioDump, processVoiceDump } from '@/lib/gemini';

// A pretend Google: three flash models; each answers as `behaviour` says.
const calls = vi.hoisted(() => [] as string[]);
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
      generateContent: async ({ model }: { model: string }) => {
        calls.push(model);
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

describe('an answer with no text', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour.clear();
  });

  it('is no success: the next model answers, and its text is used', async () => {
    behaviour.set('gemini-3-flash-preview', empty);
    const note = await processVoiceDump('call the plumber');
    expect(note.title).toBe('Plumber');
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash']);
  });

  it('empty on every Flash falls to Flash-Lite', async () => {
    behaviour.set('gemini-3-flash-preview', empty);
    behaviour.set('gemini-2.5-flash', truncated);
    await processVoiceDump('call the plumber');
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });

  it('empty everywhere gets a second pass (like a busy model), then says why', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, truncated);
    const error = await processVoiceDump('call the plumber').catch((e) => e);
    expect(calls).toHaveLength(6);
    expect(error.message).toContain('MAX_TOKENS');
    expect(emptyKindOf(error)).toBe('truncated');
    expect(classifyAiError(error)).toBe('truncated');
  });

  it('a safety block names its finishReason, blockReason, candidates, model and input, and is not asked again', async () => {
    for (const m of ['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']) behaviour.set(m, safety);
    const error = await processVoiceDump('call the plumber').catch((e) => e);
    expect(calls).toHaveLength(3); // each model once, no second pass
    expect(error.message).toContain('finish=SAFETY');
    expect(error.message).toContain('block=PROHIBITED_CONTENT');
    expect(error.message).toContain('candidates=1');
    expect(error.message).toContain('gemini-2.5-flash');
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
