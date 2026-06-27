import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, type PowerToyConfig } from "./config.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pit-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns empty object when file does not exist", async () => {
    const path = join(tempDir, "nonexistent.json");
    const cfg = await loadConfig(path);
    expect(cfg).toEqual({});
  });

  it("returns parsed config from valid JSON", async () => {
    const path = join(tempDir, "config.json");
    const data: PowerToyConfig = { "yellow-session-name": true, "compact-model": "off" };
    await saveConfig(data, path);

    const cfg = await loadConfig(path);
    expect(cfg).toEqual(data);
  });

  it("returns empty object on invalid JSON", async () => {
    const path = join(tempDir, "bad.json");
    await import("node:fs/promises").then((fs) => fs.writeFile(path, "{ not valid json }", "utf8"));

    const cfg = await loadConfig(path);
    expect(cfg).toEqual({});
  });
});

describe("saveConfig", () => {
  it("writes valid JSON to file", async () => {
    const path = join(tempDir, "out.json");
    const data: PowerToyConfig = { "hostname-footer": true };
    await saveConfig(data, path);

    const raw = await readFile(path, "utf8");
    expect(JSON.parse(raw)).toEqual(data);
  });

  it("creates parent directories if they don't exist", async () => {
    const path = join(tempDir, "nested", "deep", "config.json");
    const data: PowerToyConfig = { "compact-model": "anthropic:claude-sonnet-4-20250514" };
    await saveConfig(data, path);

    // File should exist
    const s = await stat(path);
    expect(s.isFile()).toBe(true);
  });

  it("overwrites existing file", async () => {
    const path = join(tempDir, "overwrite.json");
    await saveConfig({ "yellow-session-name": true }, path);
    await saveConfig({ "yellow-session-name": false }, path);

    const cfg = await loadConfig(path);
    expect(cfg).toEqual({ "yellow-session-name": false });
  });
});
