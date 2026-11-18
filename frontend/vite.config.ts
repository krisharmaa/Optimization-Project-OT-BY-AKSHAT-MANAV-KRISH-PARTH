import http from 'node:http';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website calls /api, which Vite forwards to the Python server (api/server.py).
// Set CLOCKWORK_API to use another address, e.g. CLOCKWORK_API=http://127.0.0.1:8001.
//
// The proxy uses persistent (keep-alive) connections. Without an agent, the proxy sends "Connection: close" to the
// backend, and on Windows uvicorn then sometimes stops sending a large response after 64 KB, which left the
// optimiser looking "stuck" on its final result.
const agent = new http.Agent({ keepAlive: true });

export default defineConfig({
  // GitHub Pages serves the site under /<repository>/; the Pages workflow sets VITE_BASE. Vercel and local use '/'.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.CLOCKWORK_API ?? 'http://127.0.0.1:8000', agent } },
  },
});
