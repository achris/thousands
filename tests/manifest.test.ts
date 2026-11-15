import { ClassicLevel } from "classic-level";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { ACADEMIA_FEATS, PACK_ID, type PF2eFeatSource } from "../src/feats/index.js";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

interface Manifest {
  id: string;
  title: string;
  version: string;
  compatibility: { minimum: string; verified: string };
  relationships: { systems: { id: string; compatibility: { minimum: string } }[] };
  esmodules: string[];
  styles: string[];
  languages: { lang: string; path: string }[];
  packs: { name: string; label: string; path: string; type: string; system: string }[];
}

let manifest: Manifest;

beforeAll(() => {
  execFileSync("npx", ["vite", "build"], { cwd: root, stdio: "pipe" });
  manifest = JSON.parse(readFileSync(resolve(dist, "module.json"), "utf8")) as Manifest;
}, 120_000);

describe("dist/module.json", () => {
  it("has the required fields", () => {
    expect(manifest.id).toBe("thousands");
    expect(manifest.title).toBeTruthy();
    expect(manifest.version).toBeTruthy();
    expect(manifest.compatibility.minimum).toBe("14");
    expect(manifest.compatibility.verified).toBe("14.370");
    expect(manifest.relationships.systems).toEqual([
      { id: "pf2e", type: "system", compatibility: { minimum: "8.7.0" } },
    ]);
    expect(manifest.esmodules).toHaveLength(1);
    expect(manifest.styles).toHaveLength(1);
    expect(manifest.languages.map((l) => l.lang)).toEqual(["en"]);
    expect(manifest.packs).toEqual([
      {
        name: PACK_ID,
        label: "Academia Feats",
        path: `packs/${PACK_ID}`,
        type: "Item",
        system: "pf2e",
        ownership: { PLAYER: "OBSERVER", ASSISTANT: "OWNER" },
      },
    ]);
  });

  it("references only files that exist in dist", () => {
    const files = [
      ...manifest.esmodules,
      ...manifest.styles,
      ...manifest.languages.map((l) => l.path),
      ...manifest.packs.map((p) => p.path),
    ];
    for (const file of files) {
      expect(existsSync(resolve(dist, file)), file).toBe(true);
    }
  });

  it("compiles all academia feats into the LevelDB pack in dist", async () => {
    const opts = { keyEncoding: "utf8", valueEncoding: "json" } as const;
    const db = new ClassicLevel<string, PF2eFeatSource>(resolve(dist, "packs", PACK_ID), opts);
    const itemsDb = db.sublevel<string, PF2eFeatSource>("items", opts);
    const stored = await itemsDb.values().all();
    await db.close();
    expect(stored).toHaveLength(ACADEMIA_FEATS.length);
  });
});
