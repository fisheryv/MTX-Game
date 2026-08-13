import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 1500
  }
} satisfies UserConfig);
