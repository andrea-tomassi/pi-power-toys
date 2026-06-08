import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "./types.js";
import { loadConfig, saveConfig } from "./config.js";
import { yellowSessionName } from "./features/yellow-session-name.js";
import { fixChromeStealth } from "./features/fix-chrome-stealth.js";
import { fixChromeDisplay } from "./features/fix-chrome-display.js";

/**
 * Registry of all power-toy features.
 * Add new features here to make them available in /power-settings.
 */
const features: PowerToyFeature[] = [yellowSessionName, fixChromeStealth, fixChromeDisplay];

export default function (pi: ExtensionAPI) {
  const config = loadConfig();

  // Enable configured features on every session start
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const cfg = await config;
    for (const feature of features) {
      const enabled = cfg[feature.id] ?? feature.defaultValue;
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

        // Build settings items
        const items = features.map((feature) => ({
          id: feature.id,
          label: feature.label,
          currentValue: (cfg[feature.id] ?? feature.defaultValue) ? "on" : "off",
          values: ["on", "off"],
        }));

        const settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 15),
          getSettingsListTheme(),
          async (id: string, newValue: string) => {
            const enabled = newValue === "on";
            cfg[id] = enabled;
            await saveConfig(cfg);

            const feature = features.find((f) => f.id === id);
            if (feature) {
              try {
                if (enabled) {
                  feature.enable(pi, ctx);
                } else {
                  feature.disable(pi, ctx);
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
