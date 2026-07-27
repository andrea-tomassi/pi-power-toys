import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.ts";
import { loadConfig, saveConfig } from "../config.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface DiscoveredModel {
  id: string;
  name?: string;
  vision?: boolean;
  maxTokens?: number;
  contextWindow?: number;
}

export interface CustomProviderDef {
  id: string;
  name?: string;
  baseUrl: string;
  api: string;
  models: DiscoveredModel[];
}

export interface CustomProvidersConfig {
  "custom-providers"?: CustomProviderDef[];
}

// ── Paths ──────────────────────────────────────────────────────────────────

function authJsonPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return join(home, ".pi", "agent", "auth.json");
}

// ── Helpers ────────────────────────────────────────────────────────────────

function register(pi: ExtensionAPI, def: CustomProviderDef): void {
  pi.registerProvider(def.id, {
    name: def.name ?? def.id,
    baseUrl: def.baseUrl,
    api: def.api ?? "openai-completions",
    models: def.models.length > 0
      ? def.models.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          reasoning: false,
          input: m.vision ? (["text", "image"] as const) : (["text"] as const),
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: m.contextWindow ?? 128000,
          maxTokens: m.maxTokens ?? 32768,
        }))
      : [
          {
            id: "discovering...",
            name: "Run /discover-models after /login",
            reasoning: false,
            input: ["text"] as const,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 4096,
          },
        ],
  });
}

async function readAuthKey(providerId: string): Promise<string | undefined> {
  try {
    const raw = await readFile(authJsonPath(), "utf8");
    const auth = JSON.parse(raw) as Record<string, { type: string; key: string }>;
    return auth[providerId]?.key;
  } catch {
    return undefined;
  }
}

// Heuristic: OpenAI's /v1/models returns no capability info, so guess vision
// from the model id/name. Covers common vision model naming conventions.
const VISION_KEYWORDS = [
  "vision",
  "vl",
  "image",
  "multimodal",
  "llava",
  "cogvlm",
  "internvl",
];

function detectVision(modelId: string): boolean {
  const id = modelId.toLowerCase();
  // "vl" must appear as a standalone token (e.g. qwen2-vl) not a substring
  if (/\bvl\b/.test(id)) return true;
  return VISION_KEYWORDS.filter((kw) => kw !== "vl").some((kw) => id.includes(kw));
}

async function discoverModels(
  baseUrl: string,
  apiKey?: string,
): Promise<{ models: DiscoveredModel[]; error?: string }> {
  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { models: [], error: `HTTP ${res.status}` };

    const body = (await res.json()) as {
      data?: Array<{ id: string }>;
    };

    if (!body.data || !Array.isArray(body.data) || body.data.length === 0) {
      return { models: [], error: "No models in response" };
    }

    return {
      models: body.data.map((m) => ({
        id: m.id,
        name: m.id,
        vision: detectVision(m.id),
      })),
    };
  } catch (err) {
    return { models: [], error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Feature ────────────────────────────────────────────────────────────────

export const customProviders: PowerToyFeature = {
  id: "custom-providers",
  label: "Custom Providers",
  description:
    "Register custom API providers. Use /add-provider, then /login, then /discover-models.",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // ── Register saved providers on startup ─────────────────────────────
    (async () => {
      try {
        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const rawStartup = cfg["custom-providers"];
        const providers: CustomProviderDef[] = Array.isArray(rawStartup) ? rawStartup : [];
        for (const p of providers) {
          register(pi, p);
        }
        if (providers.length > 0) {
          ctx.ui.notify(
            `[power-toys] ${providers.length} custom provider(s) loaded`,
            "info",
          );
        }
      } catch {
        // first run
      }
    })();

    // ── /add-provider ───────────────────────────────────────────────────
    pi.registerCommand("add-provider", {
      description: "Add a custom provider (just name + URL). Then /login to set API key.",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("run /add-provider from the pi prompt", "info");
          return;
        }

        const id = await ctx.ui.input("Provider ID (e.g. my-server):");
        if (!id?.trim()) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const displayName = await ctx.ui.input("Display name (optional):");

        const baseUrl = await ctx.ui.input("Base URL (e.g. https://example.com/v1):");
        if (!baseUrl?.trim()) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const def: CustomProviderDef = {
          id: id.trim(),
          name: displayName?.trim() || undefined,
          baseUrl: baseUrl.trim().replace(/\/+$/, ""),
          api: "openai-completions",
          models: [],
        };

        // Save
        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const raw = cfg["custom-providers"];
        const list: CustomProviderDef[] = Array.isArray(raw) ? raw : [];
        const idx = list.findIndex((p) => p.id === def.id);
        if (idx >= 0) list[idx] = def;
        else list.push(def);
        cfg["custom-providers"] = list;
        await saveConfig(cfg as Record<string, boolean | string>);

        // Register live
        register(pi, def);

        ctx.ui.notify(
          `Provider "${def.id}" added. Now use /login to set its API key, then /discover-models.`,
          "info",
        );
      },
    });

    // ── /remove-provider ────────────────────────────────────────────────
    pi.registerCommand("remove-provider", {
      description: "Remove a custom provider",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("run /remove-provider from the pi prompt", "info");
          return;
        }

        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const rawRemove = cfg["custom-providers"];
        const list: CustomProviderDef[] = Array.isArray(rawRemove) ? rawRemove : [];
        if (list.length === 0) {
          ctx.ui.notify("No custom providers", "info");
          return;
        }

        const choice = await ctx.ui.select(
          "Remove provider:",
          list.map((p) => `${p.id} - ${p.baseUrl}`),
        );
        if (!choice) return;

        const idx = list.findIndex((p) => `${p.id} - ${p.baseUrl}` === choice);
        if (idx === -1) return;

        const removed = list[idx];
        list.splice(idx, 1);
        cfg["custom-providers"] = list;
        await saveConfig(cfg as Record<string, boolean | string>);

        ctx.ui.notify(`Removed "${removed.id}"`, "info");
      },
    });

    // ── /discover-models ────────────────────────────────────────────────
    pi.registerCommand("discover-models", {
      description:
        "Fetch models from a provider's /models endpoint (run after /login sets the API key).",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("run /discover-models from the pi prompt", "info");
          return;
        }

        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const rawDiscover = cfg["custom-providers"];
        const list: CustomProviderDef[] = Array.isArray(rawDiscover) ? rawDiscover : [];
        if (list.length === 0) {
          ctx.ui.notify("No custom providers. Use /add-provider first.", "info");
          return;
        }

        const choice = await ctx.ui.select(
          "Discover models for:",
          list.map((p) => {
            const hasKey = readAuthKey(p.id).then((k) => !!k);
            // we show a sync version below
            return `${p.id} - ${p.baseUrl}${p.models.length > 0 ? ` (${p.models.length} models)` : ""}`;
          }),
        );
        if (!choice) return;

        const idx = list.findIndex(
          (p) => choice.startsWith(p.id + " -"),
        );
        if (idx === -1) return;

        const def = list[idx];

        // Read API key from auth.json
        const apiKey = await readAuthKey(def.id);
        if (!apiKey) {
          ctx.ui.notify(
            `No API key for "${def.id}". Use /login to set one first.`,
            "warning",
          );
          return;
        }

        ctx.ui.notify(`Discovering models from ${def.baseUrl}/models...`, "info");
        const result = await discoverModels(def.baseUrl, apiKey);

        if (result.error || result.models.length === 0) {
          ctx.ui.notify(
            `Discovery failed: ${result.error ?? "no models found"}`,
            "error",
          );
          return;
        }

        // Update config
        def.models = result.models;
        list[idx] = def;
        cfg["custom-providers"] = list;
        await saveConfig(cfg as Record<string, boolean | string>);

        // Re-register
        register(pi, def);

        ctx.ui.notify(
          (() => {
            const visionM = result.models.filter((m) => m.vision);
            const vm = visionM.length > 0
              ? ` [vision: ${visionM.map((m) => m.id).join(", ")}]`
              : "";
            return `Found ${result.models.length} model(s) for "${def.id}"${vm}`;
          })(),
          "info",
        );
      },
    });
  },

  disable() {
    // Providers persist until /reload. No per-session cleanup needed.
  },
};
