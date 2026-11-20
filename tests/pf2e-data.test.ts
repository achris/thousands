import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PF2E_FEAT_UUIDS,
  PF2E_SCHEMA_VERSION,
  PF2E_UNLOCK_UUIDS,
  sluggify,
} from "../src/feats/index.js";
import { BRANCHES, BRANCH_IDS, type Activity } from "../src/rules/index.js";

const root = resolve(import.meta.dirname, "..");

interface PackItem {
  _id: string;
  name: string;
  type: string;
  _stats: { compendiumSource: string; systemVersion: string };
  system: {
    slug?: string | null;
    _migration: { version: number };
    level?: { value: number };
    category?: string;
    prerequisites?: { value: { value: string }[] };
    traits: { rarity: string; value: string[] };
  };
}

let pf2eVersion: string;
let zipPath: string;
let featsById: Map<string, PackItem>;
let unlocksByUuid: Map<string, PackItem>;
let adventureActions: PackItem[];
let actions: PackItem[];
let langEn: { PF2E: Record<string, unknown> & { Skill: Record<string, string> } };
let langReEn: { PF2E: { SpecificRule: { Prompt: Record<string, string> } } };

const readZipJson = <T>(entry: string): T =>
  JSON.parse(
    execFileSync("unzip", ["-p", zipPath, entry], { encoding: "utf8", maxBuffer: 64 << 20 }),
  ) as T;

beforeAll(async () => {
  const manifest = JSON.parse(readFileSync(resolve(root, "module.json"), "utf8")) as {
    relationships: { systems: { id: string; compatibility: { minimum: string } }[] };
  };
  pf2eVersion = manifest.relationships.systems.find((s) => s.id === "pf2e")!.compatibility.minimum;
  const cacheDir = process.env.PF2E_DATA_DIR ?? resolve(tmpdir(), "pf2e-data");
  mkdirSync(cacheDir, { recursive: true });
  zipPath = resolve(cacheDir, `pf2e-${pf2eVersion}-json-assets.zip`);
  if (!existsSync(zipPath)) {
    const url = `https://github.com/foundryvtt/pf2e/releases/download/pf2e-${pf2eVersion}/json-assets.zip`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
    writeFileSync(zipPath, new Uint8Array(await res.arrayBuffer()));
  }
  featsById = new Map(readZipJson<PackItem[]>("packs/feats.json").map((f) => [f._id, f]));
  unlocksByUuid = new Map(
    (["packs/equipment.json", "packs/spells.json", "packs/class-features.json"] as const).flatMap(
      (p) => readZipJson<PackItem[]>(p).map((item) => [item._stats.compendiumSource, item]),
    ),
  );
  adventureActions = readZipJson<PackItem[]>("packs/adventure-specific-actions.json");
  actions = readZipJson<PackItem[]>("packs/actions.json");
  langEn = readZipJson("lang/en.json");
  langReEn = readZipJson("lang/re-en.json");
}, 120_000);

describe("real PF2e system data", () => {
  it("matches every referenced feat UUID, slug, level, category, trait, and prerequisite in packs/feats.json", () => {
    const first = featsById.values().next().value;
    expect(first?._stats.systemVersion).toBe(pf2eVersion);
    expect(first?.system._migration.version).toBe(PF2E_SCHEMA_VERSION);

    for (const [slug, uuid] of Object.entries(PF2E_FEAT_UUIDS)) {
      const feat = featsById.get(uuid.replace("Compendium.pf2e.feats-srd.Item.", ""));
      expect(feat, `${slug} (${uuid})`).toBeDefined();
      expect(feat?.type).toBe("feat");
      expect(feat?._stats.compendiumSource).toBe(uuid);
      expect(feat?.system.slug ?? sluggify(feat?.name ?? "")).toBe(slug);
    }

    const bySlug = (slug: keyof typeof PF2E_FEAT_UUIDS) =>
      featsById.get(PF2E_FEAT_UUIDS[slug].replace("Compendium.pf2e.feats-srd.Item.", ""))!;
    expect(bySlug("additional-lore").system).toMatchObject({
      level: { value: 1 },
      category: "skill",
    });
    expect(bySlug("magaambyan-attendant-dedication").system).toMatchObject({
      level: { value: 2 },
      category: "class",
      traits: { value: expect.arrayContaining(["archetype", "dedication"]) },
    });

    for (const id of BRANCH_IDS) {
      const b = BRANCHES[id];
      const gen = bySlug(b.generalFeat as keyof typeof PF2E_FEAT_UUIDS);
      const feat6 = bySlug(b.branchFeat6 as keyof typeof PF2E_FEAT_UUIDS);
      const feat10 = bySlug(b.branchFeat10 as keyof typeof PF2E_FEAT_UUIDS);
      expect(gen.system).toMatchObject({ level: { value: 1 }, category: "general" });
      for (const [f, lvl] of [
        [feat6, 6],
        [feat10, 10],
      ] as const) {
        expect(f.system.level?.value).toBe(lvl);
        expect(["class", "skill"]).toContain(f.system.category);
        expect(f.system.traits.value).toContain("archetype");
      }
    }

    const prereqText = (slug: keyof typeof PF2E_FEAT_UUIDS) =>
      bySlug(slug).system.prerequisites?.value.map((p) => p.value.toLowerCase()) ?? [];
    expect(prereqText("emerald-boughs-accustomation")).toEqual(
      expect.arrayContaining(["magaambyan attendant dedication", "expert in society"]),
    );
    expect(prereqText("tempest-sun-shielding")).toContain("tempest-sun redirection");
    expect(prereqText("uzunjati-recollection")).toContain("uzunjati storytelling");
  });

  it("verifies Study, Cram, Practical Research, Recall Knowledge, skill slugs, and traits", () => {
    const expected: [string, string, Activity][] = [
      ["Study", "Vt6CuD83hPiyoiOZ", "study"],
      ["Cram", "XyfC1zPgSTP01ZUr", "cram"],
      ["Practical Research", "2Kz5whXqnRsL4fEl", "practical-research"],
    ];
    for (const [name, id, activity] of expected) {
      const action = adventureActions.find((a) => a._id === id);
      expect(action).toMatchObject({
        name,
        type: "action",
        system: { traits: { rarity: "common", value: ["downtime"] } },
      });
      expect(action?.system.slug ?? sluggify(action?.name ?? "")).toBe(activity);
    }
    const rk = actions.find((a) => (a.system.slug ?? sluggify(a.name)) === "recall-knowledge");
    expect(rk).toMatchObject({ name: "Recall Knowledge", type: "action" });

    for (const b of Object.values(BRANCHES)) {
      for (const s of b.skills.filter((sk) => sk !== "lore")) {
        expect(langEn.PF2E.Skill[`${s.charAt(0).toUpperCase()}${s.slice(1)}`], s).toBeTruthy();
      }
    }
    expect(langReEn.PF2E.SpecificRule.Prompt.Skill).toBeTruthy();
    expect(langReEn.PF2E.SpecificRule.Prompt.SkillFeat).toBeTruthy();
    expect(langEn.PF2E.TraitDowntime).toBe("Downtime");
    expect(langEn.PF2E.TraitFortune).toBe("Fortune");
    expect(langEn.PF2E.TraitArchetype).toBe("Archetype");

    for (const [slug, { uuid, label }] of Object.entries(PF2E_UNLOCK_UUIDS)) {
      const item = unlocksByUuid.get(uuid);
      expect(item, `${slug} (${uuid})`).toBeDefined();
      expect(item?.name).toBe(label);
      expect(item?.system.slug ?? sluggify(item?.name ?? "")).toBe(slug);
      expect(item?.system.traits.rarity).toBe("uncommon");
    }
  });
});
