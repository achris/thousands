import { ClassicLevel } from "classic-level";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { ACADEMIA_FEATS, PACK_ID, type PF2eFeatSource } from "./src/feats/index.js";

/** Copies the manifest, stylesheet, and language files into dist/ and builds the compendium pack. */
function copyStaticFiles(): Plugin {
  const statics = ["module.json", "styles", "lang"];
  return {
    name: "thousands-copy-static",
    async closeBundle() {
      mkdirSync("dist", { recursive: true });
      for (const entry of statics) {
        cpSync(resolve(entry), resolve("dist", entry), { recursive: true });
      }
      const packDir = resolve("dist", "packs", PACK_ID);
      rmSync(packDir, { recursive: true, force: true });
      mkdirSync(packDir, { recursive: true });
      const opts = { keyEncoding: "utf8", valueEncoding: "json" } as const;
      const db = new ClassicLevel<string, PF2eFeatSource>(packDir, opts);
      const itemsDb = db.sublevel<string, PF2eFeatSource>("items", opts);
      await itemsDb.batch(
        ACADEMIA_FEATS.map((feat) => ({ type: "put", key: feat._id, value: feat })),
      );
      await db.close();
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
