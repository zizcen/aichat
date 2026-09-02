import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.grok2api.creativeworkbench",
  appName: "创作工作台",
  webDir: "dist",
  server: { androidScheme: "https" },
  // Insets are applied by MainActivity so the WebView also resizes for the
  // on-screen keyboard instead of consuming only system-bar margins.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: "disable" },
};

export default config;
