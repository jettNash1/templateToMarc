import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        editor: resolve(__dirname, 'src/editor/editor.html'),
      },
    },
  },
  publicDir: 'public',
});
