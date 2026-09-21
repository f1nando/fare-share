import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeVersion } from './scripts/benchmark-version.mjs';

export default defineConfig({
  define: { __CITY_VERSION__: JSON.stringify(codeVersion()) },
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
});
