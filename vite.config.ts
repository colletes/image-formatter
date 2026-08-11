import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // important for electron
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
