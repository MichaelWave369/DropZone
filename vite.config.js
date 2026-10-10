import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath, URL} from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      input: {
        dropzone: fileURLToPath(new URL('./index.html', import.meta.url)),
        phitar: fileURLToPath(new URL('./phitar.html', import.meta.url)),
      },
    },
  },
});
