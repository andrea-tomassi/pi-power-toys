import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

const CONFIG_PATH = join(
  process.env.HOME || process.env.USERPROFILE || "~",
  ".pi",
  "agent",
  "pi-power-toys.json",
);

export interface PowerToyConfig {
  [featureId: string]: boolean;
}

export async function loadConfig(): Promise<PowerToyConfig> {
  try {
    const data = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export async function saveConfig(config: PowerToyConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}
