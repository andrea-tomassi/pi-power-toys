import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.ts";
import { loadConfig, saveConfig } from "../config.ts";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CustomProviderModel {
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
  api?: string;
  compat?: Record<string, unknown>;
  models: CustomProviderModel[];
}

export interface CustomProvidersConfig {
  /** Array of custom provider definitions stored in pi-power-toys.json */
  "custom-providers"?: CustomProviderDef[];
}

// ── Feature ────────────────────────────────────────────────────────────────

export const customProviders: PowerToyFeature = {
  id: "custom-providers",
  label: "Custom Providers",
  description:
    "Register custom API providers (e.g. homelab inference) that appear in /login for API key entry",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // ── Register providers from saved config on startup / reload ─────────
    (async () => {
      try {
        const cfg = (await loadConfig()) as CustomProvidersConfig;
        const providers = cfg["custom-providers"] ?? [];
        for (const p of providers) {
          registerProviderFromDef(pi, p);
        }
        if (providers.length > 0) {
          ctx.ui.notify(
            `[power-toys] Registered ${providers.length} custom provider(s) — use /login to set API keys`,
            "info",
          );
        }
      } catch {
        // Silently ignore — no saved config yet
      }
    })();

    // ── /add-provider command ───────────────────────────────────────────
    pi.registerCommand("add-provider", {
      description:
        "Add a custom API provider (e.g. homelab inference). Shows in /login for API key entry.",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("/add-provider is only available in TUI mode", "error");
          return;
        }

        const { Container, Text, SettingsList } = await import("@earendil-works/pi-tui");
        const { getSettingsListTheme } = await import("@earendil-works/pi-coding-agent");

        const form: Record<string, string> = {
          id: "",
          name: "",
          baseUrl: "",
          modelId: "",
          modelName: "",
          vision: "false",
          maxTokens: "32768",
          contextWindow: "128000",
        };

        const FIELDS = [
          { id: "id", label: "Provider ID (e.g. homelab-u24-server)" },
          { id: "name", label: "Display name (optional, e.g. Homelab u24)" },
          { id: "baseUrl", label: "Base URL (e.g. https://inference.anode.red/v1)" },
          { id: "modelId", label: "Model ID (e.g. gemma4-12b-128k-vision)" },
          { id: "modelName", label: "Model display name (optional)" },
          { id: "vision", label: "Vision support", values: ["false", "true"] },
          { id: "maxTokens", label: "Max tokens" },
          { id: "contextWindow", label: "Context window" },
        ];

        let saved = false;

        await ctx.ui.custom((_tui, theme, _keybindings, done) => {
          const container = new Container();
          container.addChild(new Text(theme.fg("accent", theme.bold("\u2699 Add Provider")), 1, 0));

          const items = FIELDS.map((f) => ({
            id: f.id,
            label: f.label,
            currentValue: form[f.id],
            values: f.values ?? [],
          }));

          const list = new SettingsList(
            items,
            Math.min(items.length + 2, 20),
            getSettingsListTheme(),
            async (id: string, newValue: string) => {
              form[id] = newValue;
            },
            async () => {
              // On close, save provider if form has required fields
              if (!form.id || !form.baseUrl || !form.modelId) {
                ctx.ui.notify(
                  "Provider not saved — id, baseUrl, and modelId are required",
                  "warning",
                );
                done(undefined);
                return;
              }

              const def: CustomProviderDef = {
                id: form.id,
                name: form.name || undefined,
                baseUrl: form.baseUrl,
                api: "openai-completions",
                compat: { streaming: false },
                models: [
                  {
                    id: form.modelId,
                    name: form.modelName || undefined,
                    vision: form.vision === "true",
                    maxTokens: parseInt(form.maxTokens) || 32768,
                    contextWindow: parseInt(form.contextWindow) || 128000,
                  },
                ],
              };

              // Save to config
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

              // Register the provider live
              registerProviderFromDef(pi, def);

              saved = true;
              done(undefined);
            },
          );

          container.addChild(list);
          container.addChild(
            new Text(
              theme.fg("dim", "\u2191\u2193 navigate \u2022 enter edit \u2022 esc save & close"),
              1,
              0,
            ),
          );

          return {
            render: (w: number) => container.render(w),
            invalidate: () => container.invalidate(),
            handleInput: (data: string) => list.handleInput?.(data),
          };
        });

        if (saved) {
          ctx.ui.notify(
            `\u2705 Provider "${form.id}" registered. Use /login to set its API key.`,
            "info",
          );
        }
      },
    });

    // ── /remove-provider command ────────────────────────────────────────
    pi.registerCommand("remove-provider", {
      description: "Remove a custom provider that was added via /add-provider",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("/remove-provider is only available in TUI mode", "error");
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
          providers.map((p) => `${p.id} \u2014 ${p.baseUrl}`),
        );
        if (!choice) return;

        const selectedIdx = providers.findIndex(
          (p) => `${p.id} \u2014 ${p.baseUrl}` === choice,
        );
        if (selectedIdx === -1) return;

        const removed = providers[selectedIdx];
        providers.splice(selectedIdx, 1);
        cfg["custom-providers"] = providers;
        await saveConfig(cfg as Record<string, boolean | string>);

        ctx.ui.notify(`\u274c Removed provider "${removed.id}"`, "info");
      },
    });
  },

  disable() {
    // Providers are registered via pi.registerProvider which is global;
    // a full reload (/reload) clears them. No per-session cleanup needed.
  },
};

// ── Helper ─────────────────────────────────────────────────────────────────

function registerProviderFromDict(
  pi: ExtensionAPI,
  def: CustomProviderDef,
): void {
  const api = def.api ?? "openai-completions";

  pi.registerProvider(def.id, {
    name: def.name ?? def.id,
    baseUrl: def.baseUrl,
    api,
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
}

// Export with alias for clarity
const registerProviderFromDef = registerProviderFromDict;
