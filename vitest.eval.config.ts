import path from 'node:path';
import { defineConfig } from 'vitest/config';

// The retrieval evaluation (eval/retrieval): `npm run eval:retrieval`.
// Kept out of `npm test`: with a key it calls Gemini for embeddings.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'react-native': path.resolve(__dirname, 'tests/stubs/react-native.ts'),
    },
  },
  test: {
    include: ['eval/**/*.eval.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
