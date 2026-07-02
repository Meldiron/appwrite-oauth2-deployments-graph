import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // node-appwrite imports fetch/FormData/File/Agent from undici; in the
      // browser these are native globals, so swap undici for a light shim.
      undici: fileURLToPath(new URL('./src/shims/undici.js', import.meta.url)),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
  define: {
    // node-appwrite occasionally probes process.env; keep it defined for the browser.
    'process.env': {},
  },
})
