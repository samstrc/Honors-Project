import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The FastAPI backend runs on 8000 (cd backend && uvicorn app.main:app --reload). The dev
// server proxies /api there so the browser only ever talks to one origin, the same as in
// production, where the backend serves the built site itself.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // 127.0.0.1, not localhost: uvicorn listens on IPv4 only, and "localhost" can
        // resolve to another program listening on the same port over IPv6
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
