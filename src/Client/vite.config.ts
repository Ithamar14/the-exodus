import { defineConfig } from "vite";

const backendUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:55435";

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/health": {
        target: backendUrl,
        changeOrigin: true
      },
      "/hubs": {
        target: backendUrl,
        changeOrigin: true,
        ws: true
      }
    }
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
    strictPort: true
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  }
});
