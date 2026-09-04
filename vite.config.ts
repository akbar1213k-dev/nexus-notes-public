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
  },
  build: {
    // Pecah dependency besar ke file vendor terpisah agar bisa di-cache browser
    // dan tidak menghalangi pemuatan kode aplikasi inti.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // Pisahkan hanya library besar yang independen untuk cache terpisah.
          // Gabungkan sisanya ke satu 'vendor' untuk mencegah circular chunk.
          if (id.includes('firebase')) return 'vendor-firebase';
          if (id.includes('recharts') || id.includes('d3') || id.includes('victory-vendor') || id.includes('internmap') || id.includes('delaunator') || id.includes('robust-predicates')) return 'vendor-viz';
          if (id.includes('isomorphic-git') || id.includes('lightning-fs')) return 'vendor-git';
          return 'vendor';
        },
      },
    },
  }
});
