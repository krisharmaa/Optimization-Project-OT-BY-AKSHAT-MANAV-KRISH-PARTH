import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The website calls /api, which Vite forwards to the Python server (api/server.py).
// Set CLOCKWORK_API to use another address, e.g. CLOCKWORK_API=http://127.0.0.1:8001.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': process.env.CLOCKWORK_API ?? 'http://127.0.0.1:8000' },
  },
});
