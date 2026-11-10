# Retrieval evaluation

Measures how well "find what I said about X" (`lib/retrieve.ts`) finds the
note that answers a question: recall@5 for words alone, meaning alone, both
fused, and both fused then ranked again.

```bash
npm run eval:retrieval                                  # words only, no key needed
GEMINI_API_KEY=… npm run eval:retrieval                 # adds vector-only, hybrid, hybrid + rerank
EVAL_EMBED_MODELS=gemini-embedding-2,gemini-embedding-001 GEMINI_API_KEY=… npm run eval:retrieval
EVAL_NOTES=mine.json EVAL_QUESTIONS=mine-questions.json GEMINI_API_KEY=… npm run eval:retrieval
```

The table is printed and written to `RESULTS.md`, with a column per language
(English, Bangla, Banglish, mixed) so an embedding model that is weak on
Bangla shows up. Vectors are cached in `.cache/` (not committed), so a rerun
makes no requests.

- `notes.json`: the sample set, 63 notes in 17 threads. Written for this
  evaluation, not real notes.
- `questions.json`: 30 questions, each with the note(s) that answer it.
  File paths in `EVAL_NOTES` / `EVAL_QUESTIONS` are relative to this folder.

The sample set is small and its questions often share a word with their
answer, which flatters the keyword ranking. Numbers worth quoting come from
your own notes and questions that are worded differently from the notes.
