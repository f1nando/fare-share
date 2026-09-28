import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { codeVersion } from './scripts/benchmark-version.mjs';

export default defineConfig(({ mode }) => ({
  define: { __CITY_VERSION__: JSON.stringify(codeVersion()) },
  plugins: [react()],
  server: { watch: { ignored: ['**/public/fare-share/how-it-works/**'] } },
  build: { ...(mode === 'city' ? { outDir: 'dist-city' } : {}),
    rollupOptions: { input: mode === 'city' ? 'city.html' : { main: 'index.html', docs: 'docs/index.html', faq: 'faq/index.html', fareShare: 'fare-share/index.html', garage: 'garage/index.html', leaderboard: 'leaderboard/index.html', market: 'market/index.html', mint: 'mint/index.html', trade: 'trade/index.html', terms: 'terms/index.html', privacy: 'privacy/index.html', disclaimer: 'disclaimer/index.html', uiKit: 'ui-kit/index.html' },
      output: { manualChunks: { three: ['three'] } } } },
}));
