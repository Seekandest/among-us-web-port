import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev server for working on the UI with hot reload: run "npm run dev", then start the client with
// "--dev" (e.g. npm run tcp -- --dev) so Electron loads http://localhost:8080 instead of dist/.
// There is no proxy any more: the game traffic never goes through HTTP. It goes through Electron's
// main process, which owns the real TCP / UDP socket (see electron/main.cjs).
// https://vitejs.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        react(),
    ],
    server: {
        port: 8080,
    },
})
