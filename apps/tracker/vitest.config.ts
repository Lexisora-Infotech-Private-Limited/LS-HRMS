import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@tracker-shared': resolve(__dirname, 'src/shared') } },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
  },
});
