import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeVersion } from './scripts/benchmark-version.mjs';

export default defineConfig(({ mode }) => ({
  define: { __CITY_VERSION__: JSON.stringify(codeVersion()) },
  plugins: [react()],
  build: { ...(mode === 'city' ? { outDir: 'dist-city' } : {}),
    rollupOptions: { input: mode === 'city' ? 'city.html' : { main: 'index.html', fareShare: 'fare-share.html', test: 'test.html', drivingDemo: 'driving-demo.html' },
      output: { manualChunks: { three: ['three'] } } } },
}));
