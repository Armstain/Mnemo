import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests for the app's pure logic (reading notes, numbers, dates,
// search, filing, backups). Screens are tested in a browser separately.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // The few modules under test that ask which platform they're on.
      'react-native': path.resolve(__dirname, 'tests/stubs/react-native.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
