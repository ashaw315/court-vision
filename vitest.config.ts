import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment only. Per CLAUDE.md the test surface is data transforms,
    // network assembly, derived math, and the API contract — none of which need a
    // DOM. SVG/D3 output gets visual review, not assertions.
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
