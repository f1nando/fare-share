import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { codeVersion } from './scripts/benchmark-version.mjs';

const applicationInputs = { main: 'index.html', admin: 'admin/index.html', docs: 'docs/index.html', faq: 'faq/index.html', fareShare: 'fare-share/index.html', garage: 'garage/index.html', leaderboard: 'leaderboard/index.html', market: 'market/index.html', mint: 'mint/index.html', recoveryClaim: 'recovery-claim/index.html', trade: 'trade/index.html', terms: 'terms/index.html', privacy: 'privacy/index.html', disclaimer: 'disclaimer/index.html', uiKit: 'ui-kit/index.html' };

export default defineConfig(({ mode }) => {
  const rehearsal = mode === 'rehearsal';
  const holding = mode === 'holding';
  const productionEnv = rehearsal || holding ? loadEnv('production', process.cwd(), '') : {};
  const publicEnv = Object.fromEntries(Object.entries(productionEnv)
    .filter(([key]) => key.startsWith('VITE_'))
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));

  return {
    base: rehearsal ? '/rehearsal/' : '/',
    define: {
      __CITY_VERSION__: JSON.stringify(codeVersion()),
      __PUBLIC_HOLDING__: JSON.stringify(holding),
      ...publicEnv,
    },
    plugins: [react()],
    server: { watch: { ignored: ['**/public/fare-share/how-it-works/**'] } },
    build: {
      ...(mode === 'city' ? { outDir: 'dist-city' } : {}),
      ...(rehearsal ? { outDir: 'dist-rehearsal' } : {}),
      ...(holding ? { outDir: 'dist-holding' } : {}),
      rollupOptions: {
        input: mode === 'city' ? 'city.html' : holding ? { main: 'index.html' } : applicationInputs,
        output: { manualChunks: { three: ['three'] } },
      },
    },
  };
});
