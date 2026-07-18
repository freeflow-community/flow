import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Dev: Vite serves the SPA and proxies API + WS to the local backend so the
// client is same-origin in both dev and prod (prod = Fastify static serving).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:8787',
        ws: true, // /v1/ws WebSocket upgrade
      },
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
});
