import { ai, modelCatalog, refreshModels } from '@/lib/gemini';
import { isMissingModel, pickEmbeddingModel } from '@/lib/model-pick';
import type { MnemoItem } from '@/types/mnemo';

// gemini-embedding-2 (verified against this key's live /v1beta/models
// listing — text-embedding-004 no longer exists there). 768 dims via
// Matryoshka truncation: confirmed pre-normalized (L2 = 1.0000), so plain
// dot product is exact cosine similarity, and 768 floats is 3KB/note
// instead of 12KB at the model's default 3072.
/** The model the app prefers; `embeddingModel()` is what's actually used. */
export const EMBEDDING_MODEL = 'gemini-embedding-2';

/** This key's embedding model: the preferred one if it's there, else the newest. */
export async function embeddingModel(): Promise<string> {
  const list = await modelCatalog();
  return (list && pickEmbeddingModel(list, EMBEDDING_MODEL)) || EMBEDDING_MODEL;
}

async function embed(contents: string | string[], taskType: EmbeddingTaskType) {
  try {
    return await ai.models.embedContent({
      model: await embeddingModel(),
      contents,
      config: { taskType, outputDimensionality: EMBEDDING_DIMS },
    });
  } catch (e) {
    if (isMissingModel(e)) refreshModels();
    throw e;
  }
}
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

export { dot } from '@/lib/vector-math';

/**
 * Embeds one piece of text. `RETRIEVAL_DOCUMENT` for notes being stored,
 * `RETRIEVAL_QUERY` for a search query — Gemini's asymmetric retrieval
 * mode, which measurably improves match quality over embedding both sides
 * identically.
 */
export async function embedText(text: string, taskType: EmbeddingTaskType): Promise<Float32Array> {
  const res = await embed(text, taskType);
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
  const res = await embed(texts, 'RETRIEVAL_DOCUMENT');
  const embeddings = res.embeddings ?? [];
  return embeddings.map((e) => Float32Array.from(e.values ?? []));
}
