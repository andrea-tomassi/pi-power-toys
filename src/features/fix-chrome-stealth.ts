import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PowerToyFeature } from "../types.js";

/**
 * Path to the stealth package within pi's npm directory.
 * Resolved relative to the pi-chrome-dev-tools extension.
 */
const STEALTH_PKG_PATH = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".pi",
  "agent",
  "npm",
  "node_modules",
  "@mr_ozio",
  "playwright-stealth",
  "package.json",
);

/**
 * Patches @mr_ozio/playwright-stealth to add "require" and "default" exports.
 *
 * Problem: The package only declares "import" in its exports field, but
 * pi-chrome-dev-tools uses CJS require() to load it. Node 24's CJS resolver
 * fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 *
 * Fix: Add "require" and "default" entries pointing to the same dist/index.js.
 * Idempotent — skips if already patched.
 */
function applyPatch(): boolean {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(STEALTH_PKG_PATH, "utf8"));
  } catch {
    return false; // package not found — not installed, skip silently
  }

  const exports = pkg.exports as Record<string, Record<string, string>> | undefined;
  const rootExport = exports?.["."];
  if (!rootExport) return false;

  if (rootExport.require && rootExport.default) {
    return false; // already patched
  }

  rootExport.require = rootExport.require ?? rootExport.import ?? "./dist/index.js";
  rootExport.default = rootExport.default ?? rootExport.import ?? "./dist/index.js";

  try {
    writeFileSync(STEALTH_PKG_PATH, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

export const fixChromeStealth: PowerToyFeature = {
  id: "fix-chrome-stealth",
  label: "Fix Chrome Stealth",
  description:
    "Patch @mr_ozio/playwright-stealth exports for Node 24 CJS compatibility (fixes 'Chrome not found' in pi-chrome-dev-tools)",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    const patched = applyPatch();
    if (patched) {
      ctx.ui.notify(
        "⚡ Power Toys: patched playwright-stealth exports for Node 24",
        "info",
      );
    }
  },

  disable() {
    // No-op — the patch is harmless if left in place
  },
};
