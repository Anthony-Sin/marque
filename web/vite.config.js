import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // inotify instances are exhausted on this box — polling survives without them
    watch: { usePolling: true, interval: 700 },
    proxy: {
      '/api': 'http://localhost:8787',
      '/assets': 'http://localhost:8787',
      // regex contexts — bare '/s' and '/b' prefixes also swallowed /src/** and
      // /strategy (blank page: modules proxied to Express → HTML not JS)
      '^/s(/|$)': 'http://localhost:8787',
      '^/b(/|$)': 'http://localhost:8787',
    },
  },
});
