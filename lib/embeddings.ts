import { ai } from '@/lib/gemini';
import type { MnemoItem } from '@/types/mnemo';

// gemini-embedding-2 (verified against this key's live /v1beta/models
// listing — text-embedding-004 no longer exists there). 768 dims via
// Matryoshka truncation: confirmed pre-normalized (L2 = 1.0000), so plain
// dot product is exact cosine similarity, and 768 floats is 3KB/note
// instead of 12KB at the model's default 3072.
export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const EMBEDDING_DIMS = 768;

export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * The text actually embedded for a note — mirrors the field set
 * `lib/bm25.ts` already indexes, so keyword and vector search see the same
 * note and neither ranks on information the other ignores.
 */
export function embeddableText(
  item: Pick<MnemoItem, 'title' | 'content' | 'nextStep' | 'whereLeftOff' | 'category'> & {
    tags?: string[];
  },
): string {
  return `${item.title} ${item.content} ${item.nextStep ?? ''} ${item.whereLeftOff ?? ''} ${item.tags?.join(' ') ?? ''} ${item.category}`.trim();
}

/** Defensive re-normalization on write — the model's output is already unit-length, but a future model swap silently changing that shouldn't break similarity scoring. */
function normalize(vector: Float32Array): Float32Array {
  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) sumSq += vector[i] * vector[i];
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || !Number.isFinite(norm)) return vector;
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

/** Float32Array -> raw bytes, for the SQLite BLOB column. */
export function toBlob(vector: Float32Array): Uint8Array {
  const normalized = normalize(vector);
  return new Uint8Array(normalized.buffer, normalized.byteOffset, normalized.byteLength);
}

/**
 * Raw BLOB bytes -> Float32Array. Copies into a fresh buffer first —
 * Float32Array requires its backing buffer to start on a 4-byte boundary,
 * which a BLOB read from SQLite isn't guaranteed to do.
 */
export function fromBlob(blob: Uint8Array): Float32Array {
  const copy = blob.slice();
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

/** Cosine similarity, simplified to a plain dot product since both vectors are unit-normalized. */
export function dot(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Embeds one piece of text. `RETRIEVAL_DOCUMENT` for notes being stored,
 * `RETRIEVAL_QUERY` for a search query — Gemini's asymmetric retrieval
 * mode, which measurably improves match quality over embedding both sides
 * identically.
 */
export async function embedText(text: string, taskType: EmbeddingTaskType): Promise<Float32Array> {
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: EMBEDDING_DIMS },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values) throw new Error('Gemini returned no embedding');
  return Float32Array.from(values);
}

/**
 * Batch-embeds many texts in one request, for the backfill sweep — always
 * RETRIEVAL_DOCUMENT since this is only ever used for stored notes.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const res = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: texts,
    config: { taskType: 'RETRIEVAL_DOCUMENT', outputDimensionality: EMBEDDING_DIMS },
  });
  const embeddings = res.embeddings ?? [];
  return embeddings.map((e) => Float32Array.from(e.values ?? []));
}
