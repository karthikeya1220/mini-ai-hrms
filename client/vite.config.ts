// vite.config.ts — proxy /api to the Express server during dev.
// This avoids CORS issues and means the httpOnly cookie is set on the same origin.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        // The server already has /api in its routes, so no rewrite needed.
      },
    },
  },
});
