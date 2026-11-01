import { describe, expect, it } from 'vitest';
import { asKind, kindOf, readKind } from '@/lib/kind';
import { understand } from '@/lib/understand';

const thread = (o: object = {}) => ({ category: 'personal', ...o }) as never;

describe('reading a kind from the words', () => {
  it('ideas, without a time', () => {
    expect(readKind('What if the portfolio had a dark mode', { checklist: 0 })).toBe('idea');
    expect(readKind('app idea: a shared grocery list for the family', { checklist: 0 })).toBe('idea');
    expect(readKind('নতুন একটা আইডিয়া মাথায় এলো', { checklist: 0 })).toBe('idea');
  });
  it('an idea with a time is something to do then', () => {
    expect(readKind('idea for the talk', { checklist: 0, due: 1 })).toBe('task');
  });
  it('tasks: a time, a list, or something to do', () => {
    expect(readKind('call the dentist', { checklist: 0 })).toBe('task');
    expect(readKind('eggs, milk', { checklist: 2 })).toBe('task');
    expect(readKind('bill ta dite hobe', { checklist: 0 })).toBe('task');
    expect(readKind('বিদ্যুৎ বিল দিতে হবে', { checklist: 0 })).toBe('task');
  });
  it('projects', () => {
    expect(readKind('Portfolio redesign: new case studies and a better about page', { checklist: 0 })).toBe('project');
  });
  it('none when nothing says which', () => {
    expect(readKind('Rahim bhai er number 01711000000', { checklist: 0 })).toBeUndefined();
    expect(readKind('', { checklist: 0 })).toBeUndefined();
  });
  it('understand() reads it along with the rest', () => {
    expect(understand('remind me to pay rent tomorrow at 10am').kind).toBe('task');
    expect(understand('what if mnemo could read my calendar').kind).toBe('idea');
  });
});

describe('a thread’s kind as it grows', () => {
  it('Gemini’s "note" is no kind', () => {
    expect(asKind('note')).toBeUndefined();
    expect(asKind('project')).toBe('project');
  });
  it('an untyped thread with several notes is a project', () => {
    expect(kindOf(thread(), 1)).toBeUndefined();
    expect(kindOf(thread(), 3)).toBe('project');
  });
  it('an idea being acted on becomes a project; one only collecting thoughts stays an idea', () => {
    expect(kindOf(thread({ kind: 'idea' }), 4)).toBe('idea');
    expect(kindOf(thread({ kind: 'idea', nextStep: 'Sketch the screens' }), 4)).toBe('project');
  });
  it('a task takes more, and a shopping list never grows into a project', () => {
    expect(kindOf(thread({ kind: 'task' }), 4)).toBe('task');
    expect(kindOf(thread({ kind: 'task' }), 5)).toBe('project');
    expect(kindOf(thread({ kind: 'task', category: 'shopping' }), 12)).toBe('task');
  });
  it('set by the person, it stays, even when that’s "none"', () => {
    expect(kindOf(thread({ kind: 'task', pinned: { kind: true } }), 9)).toBe('task');
    expect(kindOf(thread({ pinned: { kind: true } }), 9)).toBeUndefined();
  });
});
