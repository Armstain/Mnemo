import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askNotes } from '@/lib/gemini';

// The model ladder: Flash first, Flash-Lite once every Flash is resting. A pretend Google: three flash models; each answers or fails as `behaviour` says.
const calls = vi.hoisted(() => [] as string[]);
const timeouts = vi.hoisted(() => [] as (number | undefined)[]);
const notices = vi.hoisted(() => [] as (string | null)[]);
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
      generateContent: async ({ model, config }: { model: string; config?: { httpOptions?: { timeout?: number } } }) => {
        calls.push(model);
        timeouts.push(config?.httpOptions?.timeout);
        return (behaviour.get(model) ?? (() => ({ text: JSON.stringify({ answer: `from ${model}`, sourceIds: [] }) })))();
      },
    };
  },
}));
vi.mock('@/lib/api-key', () => ({ getActiveApiKey: () => 'key', onApiKeyChanged: () => () => {} }));
vi.mock('@/lib/ai-mode', () => ({ aiEnabled: () => true, setAiNotice: notices.push.bind(notices) }));
vi.mock('@/lib/link-preview', () => ({ describePages: () => '' }));


const quota = (id: string) => () => {
  throw new Error(`{"error":{"code":429,"message":"Quota exceeded. Please retry in 40s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"${id}"}]}]}}`);
};
const deadline = () => {
  throw new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}');
};

describe('the model ladder', () => {
  beforeEach(() => {
    calls.length = 0;
    notices.length = 0;
    behaviour.clear();
  });

  it('a 504 on every Flash is a busy answer: Flash-Lite is tried and the note is written', async () => {
    behaviour.set('gemini-3-flash-preview', deadline);
    behaviour.set('gemini-2.5-flash', deadline);
    expect((await askNotes('q', [])).answer).toBe('from gemini-2.5-flash-lite');
    expect(notices.at(-1)).toMatch(/Flash-Lite/);
  });

  it('once every Flash is out of quota, Flash-Lite answers, and a notice says so', async () => {
    behaviour.set('gemini-3-flash-preview', quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    behaviour.set('gemini-2.5-flash', quota('GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
    calls.length = 0;
    expect((await askNotes('q', [])).answer).toBe('from gemini-2.5-flash-lite');
    expect(notices.at(-1)).toMatch(/Flash-Lite/);
  });
});
