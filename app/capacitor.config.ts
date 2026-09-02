import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.grok2api.creativeworkbench",
  appName: "创作工作台",
  webDir: "dist",
  server: { androidScheme: "https" },
  // Insets are applied once by MainActivity so system bars and the IME share
  // the same animated layout boundary.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: "disable" },
};

export default config;
