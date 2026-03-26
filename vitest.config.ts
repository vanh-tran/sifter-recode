import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: false,
    pool: 'threads',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.test.tsx'],
    environment: 'node',
    environmentMatchGlobs: [['__tests__/components/**/*.test.tsx', 'happy-dom']],
    setupFiles: ['./__tests__/setup/vitest-setup.ts'],
    alias: { '@': path.resolve(__dirname, '.') },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
