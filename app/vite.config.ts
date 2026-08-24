import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5174,
    proxy: {
      "/healthz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
      "/readyz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
      "/v1": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
    },
  },
  define: { __DEV_BUILD__: mode !== "production" },
  build: { outDir: "dist", sourcemap: false },
}));
