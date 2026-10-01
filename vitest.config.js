import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Service tests share one test database, so files run one at a time.
    fileParallelism: false,
    setupFiles: ['tests/setup.js'],
    testTimeout: 20000,
    hookTimeout: 60000,
  },
});
