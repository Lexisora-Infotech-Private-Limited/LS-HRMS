import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';

/**
 * Everything (including @lexisora/shared and zod) is bundled into the main/preload
 * outputs, so the packaged app ships without a node_modules tree — which keeps
 * electron-builder happy inside the pnpm workspace.
 */
const shared = { '@tracker-shared': resolve(__dirname, 'src/shared') };

/**
 * Content-Security-Policy for the renderer pages. Production is strict (no inline script,
 * no remote origins — the renderer never talks to the network, main does); the dev server
 * additionally needs the React refresh preamble and the HMR websocket.
 */
const CSP_PROD = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

function trackerCsp(): Plugin {
  return {
    name: 'tracker-csp',
    transformIndexHtml: {
      order: 'pre',
      handler: (html, ctx) => html.replace('%TRACKER_CSP%', ctx.server ? CSP_DEV : CSP_PROD),
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    resolve: { alias: shared },
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: shared },
    plugins: [react(), trackerCsp()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
