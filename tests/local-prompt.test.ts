import { describe, expect, it } from 'vitest';
import { LOCAL_SCHEMA, localPrompt, mergeLocal, readLocalAnswer } from '@/lib/local-prompt';

// Answers below are what Qwen3.5-0.8B (Q4_K_M) really wrote for these notes, held to LOCAL_SCHEMA.

describe('reading the on-device model’s answer', () => {
  it('keeps a grounded answer', () => {
    const note = "need to call the plumber about the kitchen sink tomorrow, it's leaking again";
    const r = readLocalAnswer('{"title":"kitchen sink leak","kind":"task","category":"work","tags":["plumber","kitchen","sink"]}', note);
    expect(r).toEqual({ title: 'kitchen sink leak', kind: 'task', category: 'work', tags: ['plumber', 'kitchen', 'sink'] });
  });

  it('reads an answer whose opening brace the engine left off', () => {
    const r = readLocalAnswer('\n  "title": "wifi password",\n  "kind": "note",\n  "category": "work",\n  "tags": ["wifi"]\n}', 'wifi password at the office is tiger1234');
    expect(r?.title).toBe('wifi password');
  });

  it('"note" is no kind, and unknown values are dropped', () => {
    const r = readLocalAnswer('{"title":"wifi","kind":"note","category":"misc","tags":[]}', 'office wifi');
    expect(r?.kind).toBeUndefined();
    expect(r?.category).toBeUndefined();
  });

  it('drops a title that copies the whole note', () => {
    const note = 'spent 300 taka on lunch with rahim at the new place near the office';
    const r = readLocalAnswer(`{"title":"${note}","kind":"note","category":"personal","tags":["lunch"]}`, note);
    expect(r?.title).toBeUndefined();
    expect(r?.tags).toEqual(['lunch']);
  });

  it('drops a title about something the note never says', () => {
    const r = readLocalAnswer('{"title":"quarterly budget review","kind":"task","category":"work","tags":[]}', 'buy milk and eggs');
    expect(r?.title).toBeUndefined();
  });

  it('a Bangla note named in English is not renamed', () => {
    const note = 'কাল অফিসে প্রেজেন্টেশন আছে, স্লাইডগুলো শেষ করতে হবে';
    const r = readLocalAnswer('{"title":"presentation","kind":"task","category":"work","tags":["presentation","office"]}', note);
    expect(r?.title).toBeUndefined();
    expect(r?.kind).toBe('task');
  });

  it('cleans tags: lowercase, no hashtags, numbers, categories, long phrases or repeats', () => {
    const r = readLocalAnswer('{"title":"gym","kind":"task","category":"health","tags":["#Gym","10","health","gym","bench press day today"]}', 'gym bench');
    expect(r?.tags).toEqual(['gym']);
  });

  it('nothing usable is null', () => {
    expect(readLocalAnswer('not json', 'x')).toBeNull();
    expect(readLocalAnswer('{"title":"","kind":"note","category":"x","tags":[]}', 'x')).toBeNull();
  });

  it('the prompt carries the note, cut to size', () => {
    expect(localPrompt('buy milk')).toContain('buy milk');
    expect(localPrompt('a'.repeat(10_000)).length).toBeLessThan(4000);
    expect(LOCAL_SCHEMA.required).toEqual(['title', 'kind', 'category', 'tags']);
  });
});

describe('what the model adds to the phone’s reading', () => {
  it('names a note whose title was cut off, and adds tags', () => {
    const m = mergeLocal(
      { title: 'Call the plumber about the kitchen sink, it’s…', kind: 'task', category: 'errands' },
      { title: 'kitchen sink leak', kind: 'task', category: 'work', tags: ['plumber', 'sink'] },
    );
    expect(m).toEqual({ title: 'Kitchen sink leak', tags: ['plumber', 'sink'] });
  });

  it('names a note that only got a placeholder', () => {
    expect(mergeLocal({ title: 'Idea', kind: 'idea' }, { title: 'bus crowding app', tags: [] }).title).toBe('Bus crowding app');
  });

  it('keeps a short title the reader got right', () => {
    expect(mergeLocal({ title: 'Dentist appointment' }, { title: 'appointment friday 10', tags: [] }).title).toBeUndefined();
  });

  it('fills kind and category only where the reader found none', () => {
    expect(mergeLocal({ title: 'Portfolio site', kind: 'project' }, { kind: 'task', category: 'work', tags: [] })).toEqual({
      category: 'work',
      tags: [],
    });
    expect(mergeLocal({ title: 'x', category: 'general' }, { category: 'study', tags: [] }).category).toBe('study');
    expect(mergeLocal({ title: 'x', category: 'health' }, { category: 'work', tags: [] }).category).toBeUndefined();
  });
});
