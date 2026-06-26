import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "./types.js";
import { loadConfig, saveConfig } from "./config.js";
import { yellowSessionName } from "./features/yellow-session-name.js";
import { compactModel } from "./features/compact-model.js";
import { customFooter } from "./features/custom-footer.js";

/**
 * Registry of all power-toy features.
 * Add new features here to make them available in /power-settings.
 */
const features: PowerToyFeature[] = [yellowSessionName, compactModel, customFooter];

/**
 * Features that use a model selector instead of on/off toggle.
 * Their config value is a "provider:model_id" string or "off".
 */
const MODEL_SELECTOR_FEATURES = new Set(["compact-model"]);

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // Enable configured features on every session start
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const cfg = await config;
    for (const feature of features) {
      const val = cfg[feature.id];
      let enabled: boolean;
      if (MODEL_SELECTOR_FEATURES.has(feature.id)) {
        enabled = typeof val === "string" && val !== "off";
      } else {
        enabled = typeof val === "boolean" ? val : feature.defaultValue;
      }
      if (enabled) {
        feature.enable(pi, ctx);
      }
    }
  });

  // /power-settings — interactive toggle menu
  pi.registerCommand("power-settings", {
    description: "Configure pi-power-toys features",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui") return;

      const { Container, SettingsList, Text } = await import("@earendil-works/pi-tui");
      const { getSettingsListTheme } = await import("@earendil-works/pi-coding-agent");

      const cfg = await config;

      await ctx.ui.custom((_tui, theme, _keybindings, done) => {
        const container = new Container();

        // Header
        container.addChild(
          new Text(theme.fg("accent", theme.bold("\u26a1 Pi Power Toys")), 1, 0),
        );

        // Build settings items — model-selector features get a model list, others get on/off
        const items = features.map((feature): { id: string; label: string; currentValue: string; values: string[] } => {
          if (MODEL_SELECTOR_FEATURES.has(feature.id)) {
            // Build model list from available models
            const availableModels = ctx.modelRegistry.getAvailable();
            const modelKeys = availableModels.map((m) => `${m.provider}:${m.id}`);
            const rawCfg = cfg[feature.id];
            const currentValue: string = typeof rawCfg === "string" ? rawCfg : "off";
            return {
              id: feature.id,
              label: feature.label,
              currentValue,
              values: ["off", ...modelKeys],
            };
          }
          const val = typeof cfg[feature.id] === "boolean" ? cfg[feature.id] : feature.defaultValue;
          return {
            id: feature.id,
            label: feature.label,
            currentValue: String(val ? "on" : "off"),
            values: ["on", "off"],
          };
        });

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          async (id: string, newValue: string) => {
            cfg[id] = newValue;
            await saveConfig(cfg);

            const feature = features.find((f) => f.id === id);
            if (feature) {
              try {
                if (MODEL_SELECTOR_FEATURES.has(id)) {
                  // Model-selector features: enable if not "off", disable otherwise
                  if (newValue !== "off") {
                    feature.enable(pi, ctx);
                  } else {
                    feature.disable(pi, ctx);
                  }
                } else {
                  const enabled = newValue === "on";
                  if (enabled) {
                    feature.enable(pi, ctx);
                  } else {
                    feature.disable(pi, ctx);
                  }
                }
              } catch (err) {
                ctx.ui.notify(
                  `Error toggling ${id}: ${err instanceof Error ? err.message : err}`,
                  "error",
                );
              }
            }
          },
          () => done(undefined),
        );

        container.addChild(settingsList);

        // Help text
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              "\u2191\u2193 navigate \u2022 enter toggle \u2022 esc close",
            ),
            1,
            0,
          ),
        );

        return {
          render: (w: number) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => {
            settingsList.handleInput?.(data);
          },
        };
      });
    },
  });


}
