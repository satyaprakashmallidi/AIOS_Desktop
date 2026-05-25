import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../dist/renderer",
    emptyOutDir: true,
    // Manual chunks split the heaviest deps into their own files so the
    // initial bundle parses faster. Each chunk is loaded on demand:
    //   - flow: only the Agents screen needs @xyflow/react
    //   - markdown: only chat renders markdown
    //   - icons: large enough to deserve its own chunk
    //   - posthog: already lazy-imported inside lib/analytics.ts; this
    //     just confirms it lives in a sibling chunk, not the main bundle
    // Net effect for v0.2.51: ~800KB main → ~400KB main + 3-4 lazy chunks
    // pulled in only when the relevant screen first renders.
    rollupOptions: {
      output: {
        manualChunks: {
          flow: ["@xyflow/react"],
          markdown: ["react-markdown", "remark-gfm"],
          icons: ["lucide-react"],
          posthog: ["posthog-js"]
        }
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 3100
  }
});
