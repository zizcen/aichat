import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.grok2api.creativeworkbench",
  appName: "Grok2API 创作工作台",
  webDir: "dist",
  server: { androidScheme: "https" },
  android: { allowMixedContent: false },
};

export default config;
