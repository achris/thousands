import { ClassicLevel } from "classic-level";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MANIFEST_URL, releaseUrls } from "../scripts/package-release.mjs";
import { ACADEMIA_FEATS, PACK_ID, type PF2eFeatSource } from "../src/feats/index.js";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const zipPath = resolve(root, "module.zip");

interface Manifest {
  id: string;
  title: string;
  version: string;
  license: string;
  manifest?: string;
  download?: string;
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

afterAll(() => {
  rmSync(zipPath, { force: true });
});

describe("dist/module.json", () => {
  it("has the required fields", () => {
    expect(manifest.id).toBe("thousands");
    expect(manifest.title).toBeTruthy();
    expect(manifest.version).toBeTruthy();
    expect(manifest.license).toBe("LICENSE");
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
      manifest.license,
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

describe("release packaging", () => {
  it("stamps version, manifest, and download into dist/module.json and zips dist/ at top level", () => {
    execFileSync("node", [resolve(root, "scripts/package-release.mjs"), "v0.1.0"], {
      cwd: root,
      stdio: "pipe",
    });

    const stamped = JSON.parse(readFileSync(resolve(dist, "module.json"), "utf8")) as Manifest;
    expect(stamped.id).toBe("thousands");
    expect(stamped.version).toBe("0.1.0");
    expect(stamped.manifest).toBe(
      "https://github.com/achris/thousands/releases/latest/download/module.json",
    );
    expect(stamped.manifest).toBe(MANIFEST_URL);
    expect(stamped.download).toBe(
      "https://github.com/achris/thousands/releases/download/v0.1.0/module.zip",
    );

    expect(existsSync(zipPath)).toBe(true);
    const entries = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" })
      .trim()
      .split("\n");
    expect(entries).toContain("module.json");
    expect(entries).toContain("LICENSE");
    expect(entries).toContain("module.js");
    expect(entries).toContain("styles/module.css");
    expect(entries).toContain("lang/en.json");
    expect(entries.some((e) => e.startsWith("dist/"))).toBe(false);

    const zippedManifest = JSON.parse(
      execFileSync("unzip", ["-p", zipPath, "module.json"], { encoding: "utf8" }),
    ) as Manifest;
    expect(zippedManifest).toEqual(stamped);
  });

  it("rejects malformed release tags", () => {
    expect(() => releaseUrls("0.1.0")).toThrow(/Invalid release tag/);
    expect(() => releaseUrls("v0.1")).toThrow(/Invalid release tag/);
  });
});
