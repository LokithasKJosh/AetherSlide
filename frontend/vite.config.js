import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    assetsDir: "web-assets",
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/assets": "http://127.0.0.1:8000",
      "/generated": "http://127.0.0.1:8000",
      "/template-files": "http://127.0.0.1:8000",
    },
  },
});
