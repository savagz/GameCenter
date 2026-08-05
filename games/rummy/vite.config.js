import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/games/rummy/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/games/rummy/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
