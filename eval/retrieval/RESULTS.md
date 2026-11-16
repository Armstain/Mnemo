# Retrieval evaluation

Written by `npm run eval:retrieval`.

17 threads, 63 notes, 63 passages, 30 questions.

| recall@5 | all (30) | en (20) | bn (4) | banglish (4) | mixed (2) | MRR |
|---|---|---|---|---|---|---|
| keyword only | 93.3% | 90.0% | 100.0% | 100.0% | 100.0% | 0.77 |
| keyword + rerank | 93.3% | 90.0% | 100.0% | 100.0% | 100.0% | 0.76 |
| keyword + search terms | 96.7% | 95.0% | 100.0% | 100.0% | 100.0% | 0.89 |
| keyword + search terms + rerank | 93.3% | 90.0% | 100.0% | 100.0% | 100.0% | 0.84 |
| vector only (gemini-embedding-2) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.90 |
| hybrid (gemini-embedding-2) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.88 |
| hybrid + rerank (gemini-embedding-2) | 100.0% | 100.0% | 100.0% | 100.0% | 100.0% | 0.92 |
