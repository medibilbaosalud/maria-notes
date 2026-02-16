import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('scheduler')) return 'vendor-react'
            if (id.includes('framer-motion')) return 'vendor-motion'
            if (id.includes('@supabase') || id.includes('dexie')) return 'vendor-data'
            if (id.includes('react-markdown')) return 'vendor-markdown'
            return 'vendor'
          }
          if (id.includes('/src/components/HistoryView')) return 'feature-history'
          if (id.includes('/src/components/AudioTestLab')) return 'feature-lab'
          if (id.includes('/src/components/SearchHistory')) return 'feature-search'
        }
      }
    }
  },
  server: {
    port: 5173,
    strictPort: true,
  },
})
