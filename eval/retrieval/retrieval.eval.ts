import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { expect, it } from 'vitest';
import { chunkEntries, retrieve, textHash, type Chunk, type RetrieveOptions } from '@/lib/retrieve';
import type { Entry, MnemoItem } from '@/types/mnemo';

// How well "find what I said about X" finds it: recall@5 over hand-written
// questions, for words alone, meaning alone, both, and both ranked again.
//
//   npm run eval:retrieval                          words only (no key needed)
//   GEMINI_API_KEY=… npm run eval:retrieval         adds the rows that need vectors
//   EVAL_EMBED_MODELS=a,b GEMINI_API_KEY=… …        compares embedding models
//   EVAL_NOTES=my-notes.json EVAL_QUESTIONS=my-questions.json …   your own data
//
// Vectors are kept in eval/retrieval/.cache so a rerun costs nothing.

const HERE = __dirname;
const K = 5;
const DIMS = 768;
const DAY = 86_400_000;

interface SampleThread {
  id: string;
  title: string;
  entries: { id: string; day: number; text: string }[];
}
interface Question {
  q: string;
  lang: string;
  expect: string[];
}

const read = <T>(file: string): T => JSON.parse(fs.readFileSync(path.resolve(HERE, file), 'utf8')) as T;
const threads = read<SampleThread[]>(process.env.EVAL_NOTES ?? 'notes.json');
const questions = read<Question[]>(process.env.EVAL_QUESTIONS ?? 'questions.json');

const items = threads.map(
  (t) =>
    ({
      id: t.id,
      title: t.title,
      content: t.entries.map((e) => e.text).join('\n'),
      tags: [],
      links: [],
      status: 'active',
      category: 'general',
      type: 'note',
      createdAt: 0,
      updatedAt: 0,
    }) as MnemoItem,
);
const entries = threads.flatMap((t) =>
  t.entries.map(
    (e): Entry => ({
      id: e.id,
      threadId: t.id,
      createdAt: Date.UTC(2026, 0, 1) + e.day * DAY,
      updatedAt: 0,
      source: 'text',
      blocks: [{ kind: 'text', markdown: e.text }],
      filing: { by: 'user' },
    }),
  ),
);
const chunks: Chunk[] = chunkEntries(items, entries);

function normalize(values: number[]): Float32Array {
  const v = Float32Array.from(values);
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
}

/** Vectors for these texts from one model, read from the cache where they're already there. */
async function embed(ai: GoogleGenAI, model: string, texts: string[], taskType: string): Promise<Map<string, Float32Array>> {
  const file = path.resolve(HERE, '.cache', `${model.replace(/[^\w.-]/g, '_')}.${taskType}.json`);
  const cache: Record<string, number[]> = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const missing = [...new Set(texts)].filter((t) => !cache[textHash(t)]);
  for (let i = 0; i < missing.length; i += 20) {
    const batch = missing.slice(i, i + 20);
    const res = await ai.models.embedContent({ model, contents: batch, config: { taskType, outputDimensionality: DIMS } });
    batch.forEach((t, j) => {
      const values = res.embeddings?.[j]?.values;
      if (!values) throw new Error(`${model} returned no embedding`);
      cache[textHash(t)] = [...normalize(values)].map((x) => Math.round(x * 1e5) / 1e5);
    });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cache));
  return new Map(texts.map((t) => [textHash(t), Float32Array.from(cache[textHash(t)])]));
}

interface Setup {
  name: string;
  options: (q: Question) => RetrieveOptions;
}

/**
 * Share of the expected notes found in the first five, averaged over
 * questions, in all and by language; and `mrr`, how near the top the first
 * expected note came (1 = always first), which shows what reranking moves.
 */
function recall(setup: Setup): Record<string, number> {
  const byLang: Record<string, number[]> = { all: [], mrr: [] };
  for (const q of questions) {
    // Counted by note: two passages of one note are one result.
    const found: string[] = [];
    for (const hit of retrieve(q.q, chunks, { ...setup.options(q), limit: 20 })) {
      if (!found.includes(hit.chunk.entryId)) found.push(hit.chunk.entryId);
    }
    const top = found.slice(0, K);
    const score = q.expect.filter((id) => top.includes(id)).length / q.expect.length;
    byLang.all.push(score);
    const first = found.findIndex((id) => q.expect.includes(id));
    byLang.mrr.push(first < 0 ? 0 : 1 / (first + 1));
    (byLang[q.lang] ??= []).push(score);
  }
  return Object.fromEntries(Object.entries(byLang).map(([lang, scores]) => [lang, scores.reduce((a, b) => a + b, 0) / scores.length]));
}

it(`recall@${K} over ${questions.length} questions`, async () => {
  const setups: Setup[] = [
    { name: 'keyword only', options: () => ({ mode: 'keyword', rerank: false }) },
    { name: 'keyword + rerank', options: () => ({ mode: 'keyword', rerank: true }) },
  ];

  const key = process.env.GEMINI_API_KEY;
  const models = (process.env.EVAL_EMBED_MODELS ?? 'gemini-embedding-2').split(',').map((m) => m.trim()).filter(Boolean);
  if (key) {
    const ai = new GoogleGenAI({ apiKey: key });
    for (const model of models) {
      const chunkVectors = await embed(ai, model, chunks.map((c) => c.text), 'RETRIEVAL_DOCUMENT');
      const threadText = new Map(items.map((i) => [i.id, `${i.title} ${i.content}`]));
      const byText = await embed(ai, model, [...threadText.values()], 'RETRIEVAL_DOCUMENT');
      const threadVectors = new Map([...threadText].map(([id, text]) => [id, byText.get(textHash(text))!]));
      const queryVectors = await embed(ai, model, questions.map((q) => q.q), 'RETRIEVAL_QUERY');
      const vectors = (q: Question) => ({ queryVector: queryVectors.get(textHash(q.q)), chunkVectors, threadVectors });
      setups.push(
        // No floor here: the baseline is the model's own ranking, not the app's cut-off.
        { name: `vector only (${model})`, options: (q) => ({ ...vectors(q), mode: 'vector', rerank: false, minSimilarity: 0 }) },
        { name: `hybrid (${model})`, options: (q) => ({ ...vectors(q), mode: 'hybrid', rerank: false }) },
        { name: `hybrid + rerank (${model})`, options: (q) => ({ ...vectors(q), mode: 'hybrid', rerank: true }) },
      );
    }
  }

  const langs = ['all', ...new Set(questions.map((q) => q.lang))];
  const rows = setups.map((s) => ({ name: s.name, scores: recall(s) }));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const table = [
    `| recall@${K} | ${langs.map((l) => `${l} (${l === 'all' ? questions.length : questions.filter((q) => q.lang === l).length})`).join(' | ')} | MRR |`,
    `|---|${langs.map(() => '---').join('|')}|---|`,
    ...rows.map((r) => `| ${r.name} | ${langs.map((l) => pct(r.scores[l])).join(' | ')} | ${r.scores.mrr.toFixed(2)} |`),
  ].join('\n');
  const note = key ? '' : '\n\nNo GEMINI_API_KEY: the vector-only, hybrid and hybrid + rerank rows were not run.';
  const report = `${threads.length} threads, ${entries.length} notes, ${chunks.length} passages, ${questions.length} questions.\n\n${table}${note}\n`;
  console.log(`\n${report}`);
  fs.writeFileSync(path.resolve(HERE, 'RESULTS.md'), `# Retrieval evaluation\n\nWritten by \`npm run eval:retrieval\`.\n\n${report}`);
  expect(rows.length).toBeGreaterThan(0);
});
