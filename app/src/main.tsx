import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

import { App } from "@/app/App";
import { TooltipProvider } from "@/components/ui/tooltip";
import "@/shared/i18n";
import "@/styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
      <Toaster position="bottom-right" closeButton={false} theme="dark" />
    </QueryClientProvider>
  </StrictMode>,
);
