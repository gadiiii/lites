import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lites/shared': path.resolve(__dirname, '../shared/src/protocol'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
        rewriteWsOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3000',
      },
    },
  },
  build: {
    // Build client directly into the server's static files directory
    outDir: '../server/dist/public',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: 'index.html',
        simple: 'simple.html',
      },
    },
  },
});
