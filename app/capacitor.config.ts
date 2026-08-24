import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.grok2api.creativeworkbench",
  appName: "创作工作台",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: "auto" },
};

export default config;
