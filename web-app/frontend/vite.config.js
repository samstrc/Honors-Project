import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend (Express) runs on 8787 and does two things: proxies /api/predict to the
// FastAPI model service, and proxies /api/chat to the research-guide service. The dev
// server proxies /api there so the browser only ever talks to one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
