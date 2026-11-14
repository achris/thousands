import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dir = join(import.meta.dirname, "../../src/rules");
const FORBIDDEN = ["game", "foundry", "CONFIG", "Hooks", "ui", "canvas"];

describe("src/rules purity", () => {
  it("references no Foundry or PF2e globals", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "")
        .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
      for (const name of FORBIDDEN) {
        expect(code, `${file} uses ${name}`).not.toMatch(new RegExp(`(?<![.\\w])${name}\\b`));
      }
    }
  });
});
