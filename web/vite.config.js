import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/assets': 'http://localhost:8787',
      '/s': 'http://localhost:8787',
      '/b': 'http://localhost:8787',
    },
  },
});
