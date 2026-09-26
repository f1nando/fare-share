import { defineConfig } from 'vite';
export default defineConfig({ build: { outDir: 'dist-nft', rollupOptions: { input: 'nft.html', output: { manualChunks: { three: ['three'] } } } } });
