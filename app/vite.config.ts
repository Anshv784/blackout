import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream", "util", "process"], globals: { Buffer: true, process: true } })],
  build: { target: "es2022", chunkSizeWarningLimit: 3000 },
  // dev: /api goes to the local Worker (`npx wrangler dev` at the repo root, port 8787)
  server: { proxy: { "/api": "http://127.0.0.1:8787" } },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
