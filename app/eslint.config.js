import js from "@eslint/js";
import tseslintParser from "@typescript-eslint/parser";
import tseslintPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  { ignores: ["dist", "android", "node_modules", "vite.config.js", "vitest.config.js"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", Buffer: "readonly", URL: "readonly", setInterval: "readonly", clearInterval: "readonly" },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      parser: tseslintParser,
      globals: {
        window: "readonly", document: "readonly", navigator: "readonly", localStorage: "readonly", sessionStorage: "readonly",
        crypto: "readonly", fetch: "readonly", URL: "readonly", URLSearchParams: "readonly", Blob: "readonly", File: "readonly", FormData: "readonly",
        DOMException: "readonly", TextEncoder: "readonly", TextDecoder: "readonly", ReadableStream: "readonly", AbortController: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly", console: "readonly", btoa: "readonly", atob: "readonly", structuredClone: "readonly",
      },
    },
    plugins: { "@typescript-eslint": tseslintPlugin, "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      "no-undef": "off",
      ...tseslintPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
];
