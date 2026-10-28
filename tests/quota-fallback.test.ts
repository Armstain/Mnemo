import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askNotes } from '@/lib/gemini';

// A pretend Google: three flash models; each answers or fails as `behaviour` says.
const calls = vi.hoisted(() => [] as string[]);
const behaviour = vi.hoisted(() => new Map<string, () => unknown>());

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
        return (behaviour.get(model) ?? (() => ({ text: JSON.stringify({ answer: `from ${model}`, sourceIds: [] }) })))();
      },
    };
  },
}));
vi.mock('@/lib/api-key', () => ({ getActiveApiKey: () => 'key', onApiKeyChanged: () => () => {} }));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true }));
vi.mock('@/lib/link-preview', () => ({ describePages: () => '' }));


const dailyQuota = () => {
  throw new Error('{"error":{"code":429,"message":"Quota exceeded. Please retry in 40s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}');
};

describe('one model out of quota', () => {
  beforeEach(() => {
    calls.length = 0;
    behaviour.clear();
  });

  it('the next model answers, and the spent one is left alone after', async () => {
    behaviour.set('gemini-3-flash-preview', dailyQuota);
    expect((await askNotes('q', [])).answer).toBe('from gemini-2.5-flash');
    expect(calls).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash']);

    calls.length = 0;
    expect((await askNotes('q', [])).answer).toBe('from gemini-2.5-flash');
    expect(calls).toEqual(['gemini-2.5-flash']);
  });

  it('when every model is spent, it says quota, and stops asking', async () => {
    behaviour.set('gemini-2.5-flash', dailyQuota);
    behaviour.set('gemini-2.5-flash-lite', dailyQuota);
    await expect(askNotes('q', [])).rejects.toThrow(/RESOURCE_EXHAUSTED/);
    calls.length = 0;
    await expect(askNotes('q', [])).rejects.toThrow(/RESOURCE_EXHAUSTED/);
    expect(calls).toEqual([]);
  });
});
