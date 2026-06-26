import { hostname } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.js";

export const hostnameFooter: PowerToyFeature = {
  id: "hostname-footer",
  label: "Hostname in Footer",
  description: "Show the machine hostname in the footer status line",
  defaultValue: true,

  enable(_pi: ExtensionAPI, ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    ctx.ui.setStatus("host", `🖥 ${hostname()}`);
  },

  disable(_pi: ExtensionAPI, ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    ctx.ui.setStatus("host", undefined);
  },
};
