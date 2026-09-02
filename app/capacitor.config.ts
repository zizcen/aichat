import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.grok2api.creativeworkbench",
  appName: "创作工作台",
  webDir: "dist",
  server: { androidScheme: "https" },
  // Let the WebView receive IME insets; the frontend applies a fallback only
  // when the composer still overlaps the visual viewport.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: "disable" },
};

export default config;
