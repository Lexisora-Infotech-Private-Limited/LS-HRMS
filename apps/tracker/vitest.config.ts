import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@tracker-shared': resolve(__dirname, 'src/shared') } },
  // Renderer smoke tests (*.spec.tsx) use the automatic JSX runtime like the app build.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    environment: 'node',
  },
});
