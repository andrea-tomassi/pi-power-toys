import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

/**
 * Resolve the config path. Exported for testing — pass a custom path to
 * load/save helpers instead of using the default.
 */
export function getConfigPath(): string {
  return join(
    process.env.HOME || process.env.USERPROFILE || "~",
    ".pi",
    "agent",
    "pi-power-toys.json",
  );
}

export interface PowerToyConfig {
  [featureId: string]: boolean | string;
}

/**
 * Load config from a file path. Falls back to empty object on read/parse errors.
 */
export async function loadConfig(path: string = getConfigPath()): Promise<PowerToyConfig> {
  try {
    const data = await readFile(path, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

/**
 * Save config to a file path, creating parent directories as needed.
 */
export async function saveConfig(
  config: PowerToyConfig,
  path: string = getConfigPath(),
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, JSON.stringify(config, null, 2), "utf8");
}
