import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "achris/thousands";
export const MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/module.json`;
const TAG_PATTERN = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

/**
 * @param {string} tag
 * @returns {{ version: string; manifest: string; download: string }}
 */
export function releaseUrls(tag) {
  const match = TAG_PATTERN.exec(tag);
  if (!match || !match[1]) {
    throw new Error(`Invalid release tag "${tag}": expected v<major>.<minor>.<patch>`);
  }
  return {
    version: match[1],
    manifest: MANIFEST_URL,
    download: `https://github.com/${REPO}/releases/download/${tag}/module.zip`,
  };
}

/**
 * @param {string} manifestPath
 * @param {string} tag
 * @returns {Record<string, unknown> & { version: string; manifest: string; download: string }}
 */
export function stampManifest(manifestPath, tag) {
  const { version, manifest, download } = releaseUrls(tag);
  const raw = /** @type {Record<string, unknown>} */ (
    JSON.parse(readFileSync(manifestPath, "utf8"))
  );
  const stamped = { ...raw, version, manifest, download };
  writeFileSync(manifestPath, `${JSON.stringify(stamped, null, 2)}\n`, "utf8");
  return stamped;
}

/**
 * @param {string} [tag]
 * @param {string} [rootDir]
 */
export function packageRelease(
  tag = "v0.0.0",
  rootDir = resolve(fileURLToPath(import.meta.url), "../.."),
) {
  const distDir = resolve(rootDir, "dist");
  const manifestPath = resolve(distDir, "module.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing ${manifestPath}; run "npm run build" before packaging.`);
  }
  const manifest = stampManifest(manifestPath, tag);
  const zipPath = resolve(rootDir, "module.zip");
  rmSync(zipPath, { force: true });
  execFileSync("zip", ["-r", "-q", zipPath, "."], { cwd: distDir, stdio: "pipe" });
  return { manifest, manifestPath, zipPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] ?? process.env.RELEASE_TAG ?? "v0.0.0";
  packageRelease(tag);
}
