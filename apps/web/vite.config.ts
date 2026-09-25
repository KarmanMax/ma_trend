import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        trend: fileURLToPath(new URL("./index.html", import.meta.url)),
        wyckoff: fileURLToPath(new URL("./wyckoff/index.html", import.meta.url))
      }
    }
  },
  server: {
    port: 5173
  }
});
