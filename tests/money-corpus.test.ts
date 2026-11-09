import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCurrency } from '@/lib/measures';
import { understand } from '@/lib/understand';

// Scores the phone's money reading against tests/corpus/money.txt (format explained at its top).
// One file of real phrasings, so a change to the reader is measured on all of them at once
// instead of on the one example that prompted it.

interface Case {
  line: number;
  text: string;
  expected: string;
  knownGap: boolean;
}

function load(): Case[] {
  const file = path.resolve(__dirname, 'corpus/money.txt');
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter(({ raw }) => raw && !raw.startsWith('#'))
    .map(({ raw, line }) => {
      const knownGap = raw.startsWith('~');
      const [text, expected] = raw.replace(/^~\s*/, '').split(/\s+=>\s+/);
      if (!text || expected === undefined) throw new Error(`tests/corpus/money.txt:${line}: expected "text  =>  expected"`);
      return { line, text: text.trim(), expected: expected.trim(), knownGap };
    });
}

const now = new Date('2026-11-09T10:00:00').getTime();

/** What the reader makes of a note's money, in the corpus's own notation. */
export function readMoney(text: string): string {
  const money = understand(text, { now, currency: 'BDT' }).measures.filter((m) => isCurrency(m.unit));
  return money.length === 0 ? 'none' : money.map((m) => `${m.metric} ${m.value}`).join(', ');
}

const normal = (s: string) => s.split(',').map((p) => p.trim().replace(/\s+/g, ' ')).join(', ');

describe('the money corpus', () => {
  const cases = load();
  const results = cases.map((c) => ({ ...c, got: readMoney(c.text), right: readMoney(c.text) === normal(c.expected) }));
  const right = results.filter((r) => r.right).length;

  it('prints the score', () => {
    const misses = results.filter((r) => !r.right);
    const lines = misses.map((r) => `  ${r.knownGap ? 'gap ' : 'MISS'} :${r.line}  ${r.text}\n         wanted ${r.expected}\n         read   ${r.got}`);
    console.log(`money corpus: ${right}/${results.length} read right (${Math.round((100 * right) / results.length)}%)\n${lines.join('\n')}`);
    expect(results.length).toBeGreaterThan(0);
  });

  it('every line not marked as a known gap reads right', () => {
    const regressions = results.filter((r) => !r.right && !r.knownGap).map((r) => `:${r.line} ${r.text} — wanted ${r.expected}, read ${r.got}`);
    expect(regressions).toEqual([]);
  });

  it('a known gap that now reads right has its "~" removed, so it stays right', () => {
    const fixed = results.filter((r) => r.right && r.knownGap).map((r) => `:${r.line} ${r.text}`);
    expect(fixed).toEqual([]);
  });
});
