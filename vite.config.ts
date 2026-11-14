import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Copies the manifest, stylesheet, and language files into dist/ untouched. */
function copyStaticFiles(): Plugin {
  const statics = ["module.json", "styles", "lang"];
  return {
    name: "thousands-copy-static",
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      for (const entry of statics) {
        cpSync(resolve(entry), resolve("dist", entry), { recursive: true });
      }
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    lib: {
      entry: resolve("src/module.ts"),
      formats: ["es"],
      fileName: () => "module.js",
    },
  },
  plugins: [copyStaticFiles()],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
