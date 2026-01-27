import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Definisi ini penting untuk library isomorphic-git agar tidak crash di browser
    'global': 'window',
  },
  resolve: {
    alias: {
      // Memastikan buffer diarahkan ke buffer browser
      buffer: 'buffer',
    },
  },
  optimizeDeps: {
    include: ['buffer', 'isomorphic-git', '@isomorphic-git/lightning-fs']
  }
});
