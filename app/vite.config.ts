import path from "node:path";
import fs from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const packageVersion = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
).version as string;

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    port: 5174,
    proxy: {
      "/healthz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
      "/readyz": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
      "/v1": process.env.VITE_DEV_API_TARGET ?? "http://127.0.0.1:8000",
    },
  },
  define: {
    __DEV_BUILD__: mode !== "production",
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  build: { outDir: "dist", sourcemap: false },
}));
