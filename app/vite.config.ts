import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // React + Supabase change rarely, so they get their own chunk that stays
        // cached across deploys; only the app's own code is re-downloaded.
        // (jsPDF and friends stay lazy — loaded only when a PDF is made.)
        codeSplitting: {
          groups: [
            { name: 'vendor', test: /node_modules[\\/](react|react-dom|scheduler|@supabase)[\\/]/ },
          ],
        },
      },
    },
  },
})
