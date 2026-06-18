import preact from "@preact/preset-vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, type Plugin } from "vite";

function perfPlugin(): Plugin {
  const criticalPath = resolve(import.meta.dirname, "src/critical.css");

  return {
    name: "xiv-arbitrage-perf",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        let result = html;

        // 1. Inline a tiny critical CSS bundle early so the first paint is never unstyled.
        if (existsSync(criticalPath)) {
          const criticalCss = readFileSync(criticalPath, "utf-8").trim();
          result = result.replace(
            /(<meta name="viewport"[^>]*>)/,
            `$1<style>${criticalCss}</style>`,
          );
        }

        // 2. Load the main stylesheet asynchronously. It is non-critical now that
        //    critical.css handles the initial paint. The <noscript> fallback keeps
        //    the page usable when JS is disabled.
        const styleMatch = result.match(/<link rel="stylesheet"[^>]*href="([^"]+\.css)"[^>]*>/);
        if (styleMatch) {
          const styleHref = styleMatch[1];
          const asyncStyle = `<link rel="preload" href="${styleHref}" as="style" onload="this.rel='stylesheet'" crossorigin><noscript><link rel="stylesheet" href="${styleHref}" crossorigin></noscript>`;
          result = result.replace(styleMatch[0], asyncStyle);
        }

        return result;
      },
    },
  };
}

export default defineConfig({
  plugins: [
    preact(),
    perfPlugin(),
    process.env.ANALYZE === "true" &&
      visualizer({
        open: false,
        filename: "dist/stats.html",
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
