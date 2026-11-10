# Retrieval evaluation

Written by `npm run eval:retrieval`.

17 threads, 63 notes, 63 passages, 30 questions.

| recall@5 | all (30) | en (20) | bn (4) | banglish (4) | mixed (2) | MRR |
|---|---|---|---|---|---|---|
| keyword only | 93.3% | 90.0% | 100.0% | 100.0% | 100.0% | 0.77 |
| keyword + rerank | 93.3% | 90.0% | 100.0% | 100.0% | 100.0% | 0.76 |

No GEMINI_API_KEY: the vector-only, hybrid and hybrid + rerank rows were not run.
