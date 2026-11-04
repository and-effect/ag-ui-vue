import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // Demos import the library by its published name but run against the
      // source, so edits to ../../src hot-reload here without a build.
      '@and-effect/ag-ui-vue': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
    },
    dedupe: ['vue'],
  },
  optimizeDeps: {
    // Demos are lazy routes; listing their deps up front stops Vite from
    // discovering them mid-navigation and force-reloading the page.
    include: ['@lucide/vue', 'reka-ui', 'marked', 'dompurify', 'zod', '@vueuse/core'],
  },
  define: {
    // @ag-ui/client reads process.env
    'process.env': {},
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
