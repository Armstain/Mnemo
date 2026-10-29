import { describe, expect, it, vi } from 'vitest';
import { aiErrorText, classifyAiError, dailyResetText } from '@/lib/api-key';
import { DAILY_QUOTA_PAUSE_MS, isMissingModel, isOverloaded, pickEmbeddingModel, pickTextModels, nextDailyReset, pickTtsModel, quotaInfo, quotaPause, type ModelInfo } from '@/lib/model-pick';

vi.mock('expo-secure-store', () => ({}));
vi.mock('@google/genai', () => ({ GoogleGenAI: class {} }));

const m = (name: string, ...actions: string[]): ModelInfo => ({ name, actions: actions.length ? actions : ['generateContent'] });
const list = [
  m('gemini-2.5-flash'),
  m('gemini-2.5-flash-lite'),
  m('gemini-2.5-pro'),
  m('gemini-3-flash-preview'),
  m('gemini-2.5-flash-preview-tts'),
  m('gemini-2.5-pro-preview-tts'),
  m('gemini-2.5-flash-image'),
  m('gemini-2.0-flash-live-001'),
  m('gemini-embedding-001', 'embedContent'),
  m('text-embedding-004', 'embedContent'),
  m('gemma-3-27b-it'),
];

describe('choosing models from what the key can use', () => {
  it('text: newest flash first even as a preview, older ones behind it, lite last; no tts/image/live', () => {
    expect(pickTextModels(list)).toEqual(['gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });
  it('text: a newer stable generation beats everything older', () => {
    const newer = [...list, m('gemini-3.5-flash'), m('gemini-3.5-flash-lite')];
    // Three Flash models, then the best Flash-Lite as the last rung (it has its own quota).
    expect(pickTextModels(newer)).toEqual(['gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash', 'gemini-3.5-flash-lite']);
  });
  it('text: Flash-Lite is kept even when more than three full Flash models are listed', () => {
    const many = [m('gemini-3.5-flash'), m('gemini-3-flash'), m('gemini-2.5-flash'), m('gemini-2.0-flash'), m('gemini-2.5-flash-lite'), m('gemini-2.0-flash-lite')];
    expect(pickTextModels(many)).toEqual(['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite']);
  });
  it('text: at the same version, stable goes before preview', () => {
    expect(pickTextModels([m('gemini-3-flash-preview'), m('gemini-3-flash')])).toEqual(['gemini-3-flash', 'gemini-3-flash-preview']);
  });
  it('an alias that always points at the newest wins', () => {
    expect(pickTextModels([...list, m('gemini-flash-latest')])[0]).toBe('gemini-flash-latest');
  });
  it('no flash at all: any general Gemini model', () => {
    expect(pickTextModels([m('gemini-2.5-pro'), m('gemma-3-27b-it')])).toEqual(['gemini-2.5-pro']);
  });
  it('nothing usable: empty, so the built-in names are tried', () => {
    expect(pickTextModels([m('text-embedding-004', 'embedContent')])).toEqual([]);
  });
  it('speech: a flash tts model', () => {
    expect(pickTtsModel(list)).toBe('gemini-2.5-flash-preview-tts');
  });
  it('embeddings: the preferred model if the key has it, else the newest gemini one', () => {
    expect(pickEmbeddingModel([...list, m('gemini-embedding-2', 'embedContent')], 'gemini-embedding-2')).toBe('gemini-embedding-2');
    expect(pickEmbeddingModel(list, 'gemini-embedding-2')).toBe('gemini-embedding-001');
  });
  it('only a missing model is worth trying the next for', () => {
    expect(isMissingModel(new Error('{"error":{"code":404,"message":"models/gemini-3.1-flash is not found for API version v1beta","status":"NOT_FOUND"}}'))).toBe(true);
    expect(isMissingModel(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(false);
    expect(isMissingModel(new Error('API key not valid'))).toBe(false);
  });
  it("a model out of quota sits out: a day's allowance for an hour, a minute's for the wait Google names", () => {
    const daily = new Error(
      '{"error":{"code":429,"message":"You exceeded your current quota. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20, model: gemini-3-flash\\nPlease retry in 41.2s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
    );
    const perMinute = new Error(
      '{"error":{"code":429,"message":"Quota exceeded for metric: generate_content_free_tier_requests, limit: 10. Please retry in 37.5s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},{"retryDelay":"37s"}]}}',
    );
    expect(quotaPause(daily)).toBe(DAILY_QUOTA_PAUSE_MS);
    expect(quotaPause(perMinute)).toBe(37_500);
    expect(quotaPause(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(60_000);
    expect(quotaPause(new Error('API key not valid'))).toBeUndefined();
    expect(quotaPause(new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}'))).toBeUndefined();
  });
  it('a busy model is worth another try, a spent quota is not', () => {
    expect(isOverloaded(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'))).toBe(true);
    expect(isOverloaded(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(false);
    expect(isOverloaded(new Error('API key not valid'))).toBe(false);
  });
  const e504 = new Error('{"error":{"code":504,"message":"Deadline expired before operation could complete.","status":"DEADLINE_EXCEEDED"}}');
  const daily429 = new Error(
    '{"error":{"code":429,"message":"Quota exceeded. Please retry in 41.2s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}',
  );
  const minute429 = new Error(
    '{"error":{"code":429,"message":"Quota exceeded. Please retry in 37.5s.","status":"RESOURCE_EXHAUSTED","details":[{"violations":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}]}}',
  );
  it('the daily reset is midnight Pacific, whatever the phone\'s zone: 07:00 UTC in summer, 08:00 in winter', () => {
    expect(nextDailyReset(Date.UTC(2026, 9, 29, 12))).toBe(Date.UTC(2026, 9, 30, 7)); // PDT
    expect(nextDailyReset(Date.UTC(2026, 11, 15, 3))).toBe(Date.UTC(2026, 11, 15, 8)); // PST, evening before
    expect(nextDailyReset(Date.UTC(2026, 11, 15, 9))).toBe(Date.UTC(2026, 11, 16, 8));
    expect(nextDailyReset(Date.UTC(2026, 10, 1, 3))).toBe(Date.UTC(2026, 10, 1, 7)); // 31 Oct evening: that midnight is still PDT
    expect(nextDailyReset(Date.UTC(2026, 10, 1, 10))).toBe(Date.UTC(2026, 10, 2, 8)); // after the clocks went back
    expect(nextDailyReset(Date.UTC(2026, 2, 8, 12))).toBe(Date.UTC(2026, 2, 9, 7)); // after they went forward (8 Mar 2026)
    expect(dailyResetText(Date.UTC(2026, 9, 29, 12))).toMatch(/^It resets at .+ your time\.$/);
  });
  it('a 504 is busy: tried on another model and a second pass, not thrown at once', () => {
    expect(isOverloaded(e504)).toBe(true);
    expect(classifyAiError(e504)).toBe('busy');
    expect(quotaPause(e504)).toBeUndefined();
    expect(aiErrorText(e504)).toMatch(/busy/);
  });
  it('a 429 says whether the day or the minute ran out', () => {
    expect(quotaInfo(daily429)).toEqual({ daily: true });
    expect(quotaInfo(minute429)).toEqual({ daily: false, retryMs: 37_500 });
    expect(classifyAiError(daily429)).toBe('quota');
    expect(classifyAiError(minute429)).toBe('quota');
    expect(aiErrorText(daily429)).toMatch(/daily limit is used up\. It resets at .+ your time\./);
    const minuteText = aiErrorText(minute429);
    expect(minuteText).toContain('Try again in 38 seconds.');
    expect(minuteText).not.toMatch(/daily/i);
    expect(aiErrorText(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toContain('Try again in a minute.');
  });
});
