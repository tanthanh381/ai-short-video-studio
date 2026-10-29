import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** The pages a person can open or refresh by address. GitHub Pages answers an unknown path with 404 (404.html then sends the visitor to the app); a copy of the app at each known path answers 200 instead. */
export const STATIC_ROUTES = ["login", "reset-password", "dub-subtitle", "tts", "exports", "system", "settings"];

function routePages(): Plugin {
  let outDir = "dist";
  return {
    name: "route-pages",
    apply: "build",
    configResolved(config) { outDir = join(config.root, config.build.outDir); },
    closeBundle() {
      for (const route of STATIC_ROUTES) {
        mkdirSync(join(outDir, route), { recursive: true });
        copyFileSync(join(outDir, "index.html"), join(outDir, route, "index.html"));
      }
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), routePages()],
  base: mode === "production" ? "/ai-short-video-studio/" : "/",
  build: {
    sourcemap: true,
    target: "es2022",
  },
}));
