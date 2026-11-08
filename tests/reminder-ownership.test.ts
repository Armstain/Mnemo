import { describe, expect, it } from 'vitest';
import { decideFiling } from '@/lib/filing';
import { foldReminders, mayAutoFile, replacesPlaceReminder, samePlaceReminder, withReminders } from '@/lib/reminder-ownership';
import type { MnemoItem, PlaceReminder } from '@/types/mnemo';

// Connecting notes must never merge, drop or overwrite their reminders
// (docs/audits/tasks-and-reminders-2026-11.md, P1).

const NOW = Date.UTC(2026, 10, 9, 9);
const HOUR = 3600_000;

const at = (placeId: string, extra: Partial<PlaceReminder> = {}): PlaceReminder => ({ placeId, on: 'arrive', setAt: 1, insideAtSet: false, ...extra });
const thread = (title: string, extra: Partial<MnemoItem> = {}) =>
  ({ id: title, title, status: 'active', ...extra }) as Pick<MnemoItem, 'title' | 'status' | 'place' | 'dueDate' | 'repeat' | 'laterSteps' | 'nextStep'>;

describe('what counts as overwriting a place reminder', () => {
  it('a different place, side or schedule replaces; the same one set twice does not', () => {
    const a = thread('A', { place: at('a') });
    expect(replacesPlaceReminder(a, at('tongi'))).toBe(true);
    expect(replacesPlaceReminder(a, at('a', { on: 'leave' }))).toBe(true);
    expect(replacesPlaceReminder(a, at('a', { repeat: 'weekdays' }))).toBe(true);
    expect(replacesPlaceReminder(a, at('a'))).toBe(false);
    expect(samePlaceReminder(at('a', { repeat: 'days', days: [1, 3] }), at('a', { repeat: 'days', days: [1, 3] }))).toBe(true);
  });

  it('a reminder that already went off, or a finished thread, has nothing left to overwrite', () => {
    expect(replacesPlaceReminder(thread('A', { place: at('a', { firedAt: 5 }) }), at('tongi'))).toBe(false);
    expect(replacesPlaceReminder(thread('A', { place: at('a'), status: 'completed' }), at('tongi'))).toBe(false);
  });
});

describe('auto-filing never moves a capture that owns a reminder it could lose', () => {
  it('a place reminder, or one heard in a recording, keeps the note in its own thread', () => {
    expect(mayAutoFile(thread('B', { place: at('tongi') }))).toBe(false);
    expect(mayAutoFile(thread('B'), at('tongi'))).toBe(false);
  });
  it('a repeating time reminder too; a plain note, or a one-off reminder (queued on the other thread), may be filed', () => {
    expect(mayAutoFile(thread('B', { dueDate: NOW + HOUR, repeat: 'daily' }))).toBe(false);
    expect(mayAutoFile(thread('B', { dueDate: NOW + HOUR }))).toBe(true);
    expect(mayAutoFile(thread('B'))).toBe(true);
    expect(mayAutoFile(undefined)).toBe(true);
  });

  it('the decision: a sure match that would merge reminders becomes a suggestion', () => {
    const match = { match: 'existing' as const, threadId: 'A', confidence: 0.95, reason: 'both about arriving' };
    const candidates = [{ id: 'A', title: 'A', category: 'personal' as const, idleDays: 0 }];
    expect(decideFiling({ filedBy: 'new', match, candidates }).action).toBe('attach');
    expect(decideFiling({ filedBy: 'new', match, candidates, ownsReminder: true })).toMatchObject({ action: 'suggest', threadId: 'A' });
    // Nothing else about filing changes.
    expect(decideFiling({ filedBy: 'new', match: { ...match, confidence: 0.3 }, candidates, ownsReminder: true }).action).toBe('stay');
  });
});

describe('a thread folded into another by moving its last note', () => {
  it('two place reminders: refused, with a reason, so neither is lost', () => {
    const fold = foldReminders(thread('Tongi', { place: at('tongi') }), thread('Location A', { place: at('a') }), NOW);
    expect(fold.ok).toBe(false);
    if (!fold.ok) expect(fold.reason).toContain('Location A');
  });

  it('a place reminder moves to a thread that has none (or the very same one)', () => {
    const fold = foldReminders(thread('Tongi', { place: at('tongi') }), thread('Errands'), NOW);
    expect(fold).toEqual({ ok: true, carry: { place: at('tongi') } });
    expect(foldReminders(thread('A2', { place: at('a') }), thread('A', { place: at('a') }), NOW)).toEqual({ ok: true, carry: {} });
  });

  it('a one-off time reminder is queued after the other thread’s own; a repeating one onto a busy thread is refused', () => {
    const into = thread('Report', { dueDate: NOW + 2 * HOUR });
    const fold = foldReminders(thread('File', { dueDate: NOW + 5 * HOUR, nextStep: 'Bring the file' }), into, NOW);
    expect(fold).toEqual({ ok: true, carry: { laterSteps: [{ at: NOW + 5 * HOUR, step: 'Bring the file' }] } });
    expect(foldReminders(thread('Pills', { dueDate: NOW - HOUR, repeat: 'daily' }), into, NOW).ok).toBe(false);
    // Onto a thread with no reminder, the schedule moves whole.
    expect(foldReminders(thread('Pills', { dueDate: NOW - HOUR, repeat: 'daily' }), thread('Health'), NOW)).toEqual({
      ok: true,
      carry: { dueDate: NOW - HOUR, repeat: 'daily' },
    });
  });

  it('nothing to carry: always fine', () => {
    expect(foldReminders(thread('Note'), thread('A', { place: at('a'), dueDate: NOW + HOUR, repeat: 'weekly' }), NOW)).toEqual({ ok: true, carry: {} });
  });
});

describe('adding a time reminder to a thread with a repeating one', () => {
  it('queues it instead of replacing the schedule (its stored first time is in the past)', () => {
    const daily = { dueDate: NOW - 3 * 24 * HOUR, repeat: 'daily' as const };
    expect(withReminders(daily, { due: NOW + HOUR, later: [] }, NOW)).toEqual({ laterSteps: [{ at: NOW + HOUR, step: undefined }] });
  });
  it('replaces a one-off that already passed, as before', () => {
    expect(withReminders({ dueDate: NOW - HOUR }, { due: NOW + HOUR, later: [] }, NOW)).toEqual({ dueDate: NOW + HOUR, repeat: undefined });
  });
});
