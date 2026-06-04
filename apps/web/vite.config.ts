import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@gamedata': path.resolve(__dirname, '../../packages/shared/src/Filtered Data'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // All /api/* and /uploads/* requests are forwarded to the Express API during dev
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
