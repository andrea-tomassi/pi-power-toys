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

// ── Feature ────────────────────────────────────────────────────────────────

export const customProviders: PowerToyFeature = {
  id: "custom-providers",
  label: "Custom Providers",
  description:
    "Register custom API providers that appear in /login for API key entry. Models are auto-discovered from the endpoint.",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // ── Register saved providers on startup ─────────────────────────────
    (async () => {
      try {
        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const providers = cfg["custom-providers"] ?? [];
        for (const p of providers) {
          pi.registerProvider(p.id, {
            name: p.name ?? p.id,
            baseUrl: p.baseUrl,
            api: p.api ?? "openai-completions",
            models: p.models.map((m) => ({
              id: m.id,
              name: m.name ?? m.id,
              reasoning: false,
              input: m.vision ? (["text", "image"] as const) : (["text"] as const),
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: m.contextWindow ?? 128000,
              maxTokens: m.maxTokens ?? 32768,
            })),
          });
        }
        if (providers.length > 0) {
          ctx.ui.notify(
            `[power-toys] \u2190 ${providers.length} custom provider(s) loaded`,
            "info",
          );
        }
      } catch {
        // First run — no saved config
      }
    })();

    // ── /add-provider command ───────────────────────────────────────────
    pi.registerCommand("add-provider", {
      description: "Add a custom provider. Models are auto-discovered from the endpoint.",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("run /add-provider from the pi prompt", "info");
          return;
        }

        // 1. Ask for provider ID
        const id = await ctx.ui.input("Provider ID (e.g. my-server):");
        if (!id || !id.trim()) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        const providerId = id.trim();

        // 2. Ask for display name
        const displayName = await ctx.ui.input("Display name (optional, e.g. My Server):");

        // 3. Ask for base URL
        const baseUrl = await ctx.ui.input("Base URL (e.g. https://example.com/v1):");
        if (!baseUrl || !baseUrl.trim()) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }
        const url = baseUrl.trim().replace(/\/+$/, "");

        // 4. Auto-discover models from /models endpoint
        ctx.ui.notify("Discovering models...", "info");
        let models: DiscoveredModel[] = [];
        let discoverError: string | undefined;

        try {
          const modelsUrl = `${url}/models`;
          const res = await fetch(modelsUrl, {
            signal: AbortSignal.timeout(10_000),
          });
          if (!res.ok) {
            discoverError = `HTTP ${res.status} from ${modelsUrl}`;
          } else {
            const body = (await res.json()) as {
              data?: Array<{ id: string; name?: string }>;
              object?: string;
            };

            if (body.data && Array.isArray(body.data) && body.data.length > 0) {
              models = body.data.map((m: { id: string; name?: string }) => ({
                id: m.id,
                name: m.name ?? m.id,
                vision: false,
              }));
              ctx.ui.notify(
                `Found ${models.length} model(s): ${models.map((m) => m.id).join(", ")}`,
                "info",
              );
            } else {
              discoverError = "No models in response";
            }
          }
        } catch (err) {
          discoverError = err instanceof Error ? err.message : String(err);
        }

        if (discoverError) {
          // Fallback: ask user to enter model ID manually
          ctx.ui.notify(`Could not discover models: ${discoverError}`, "warning");
          const manualId = await ctx.ui.input("Enter model ID manually (or leave empty to cancel):");
          if (!manualId || !manualId.trim()) {
            ctx.ui.notify("Cancelled", "info");
            return;
          }
          models = [{ id: manualId.trim(), name: manualId.trim(), vision: false }];
        }

        // 5. Build provider definition
        const def: CustomProviderDef = {
          id: providerId,
          name: (displayName && displayName.trim()) || undefined,
          baseUrl: url,
          api: "openai-completions",
          models,
        };

        // 6. Save to config
        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const existing = cfg["custom-providers"] ?? [];
        const idx = existing.findIndex((p) => p.id === def.id);
        if (idx >= 0) {
          existing[idx] = def;
        } else {
          existing.push(def);
        }
        cfg["custom-providers"] = existing;
        await saveConfig(cfg as Record<string, boolean | string>);

        // 7. Register live
        pi.registerProvider(def.id, {
          name: def.name ?? def.id,
          baseUrl: def.baseUrl,
          api: def.api,
          models: def.models.map((m) => ({
            id: m.id,
            name: m.name ?? m.id,
            reasoning: false,
            input: m.vision ? (["text", "image"] as const) : (["text"] as const),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: m.contextWindow ?? 128000,
            maxTokens: m.maxTokens ?? 32768,
          })),
        });

        ctx.ui.notify(
          `\u2705 Provider "${providerId}" with ${models.length} model(s). Use /login to set its API key.`,
          "info",
        );
      },
    });

    // ── /remove-provider command ────────────────────────────────────────
    pi.registerCommand("remove-provider", {
      description: "Remove a custom provider added via /add-provider",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("run /remove-provider from the pi prompt", "info");
          return;
        }

        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const providers = cfg["custom-providers"] ?? [];
        if (providers.length === 0) {
          ctx.ui.notify("No custom providers to remove", "info");
          return;
        }

        const choice = await ctx.ui.select(
          "Remove provider:",
          providers.map((p) => `${p.id} - ${p.baseUrl}`),
        );
        if (!choice) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const selectedIdx = providers.findIndex(
          (p) => `${p.id} - ${p.baseUrl}` === choice,
        );
        if (selectedIdx === -1) return;

        const removed = providers[selectedIdx];
        providers.splice(selectedIdx, 1);
        cfg["custom-providers"] = providers;
        await saveConfig(cfg as Record<string, boolean | string>);

        ctx.ui.notify(`Removed provider "${removed.id}"`, "info");
      },
    });
  },

  disable() {
    // Providers registered via pi.registerProvider() persist until /reload.
    // No per-session cleanup needed — disable/enable toggles startup load.
  },
};
