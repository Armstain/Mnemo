import { describe, expect, it } from 'vitest';
import { isMissingModel, isOverloaded, pickEmbeddingModel, pickTextModels, pickTtsModel, type ModelInfo } from '@/lib/model-pick';

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
  it('text: stable flash first, newer preview next, lite last; no tts/image/live', () => {
    expect(pickTextModels(list)).toEqual(['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash-lite']);
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
  it('a busy model is worth another try, a spent quota is not', () => {
    expect(isOverloaded(new Error('{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}'))).toBe(true);
    expect(isOverloaded(new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}'))).toBe(false);
    expect(isOverloaded(new Error('API key not valid'))).toBe(false);
  });
});
