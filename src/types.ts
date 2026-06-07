import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export interface PowerToyFeature {
  id: string;
  label: string;
  description: string;
  defaultValue: boolean;
  enable: (pi: ExtensionAPI, ctx: ExtensionContext) => void;
  disable: (pi: ExtensionAPI, ctx: ExtensionContext) => void;
}
