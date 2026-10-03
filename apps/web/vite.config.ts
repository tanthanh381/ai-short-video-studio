import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "production" ? "/ai-short-video-studio/" : "/",
  build: {
    sourcemap: true,
    target: "es2022",
  },
}));
