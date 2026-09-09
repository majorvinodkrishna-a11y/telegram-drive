// Dev-only config to preview the app inside the sandbox webview.
// NOT part of the Tauri build (vite.config.ts is used for that).
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
  },
});
