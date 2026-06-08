# ⚡ Pi Power Toys

Custom power-user features for the [Pi coding agent](https://pi.dev). Each feature can be toggled on/off via the `/power-settings` menu and persists across restarts.

## Install

```bash
pi install npm:pi-power-toys
```

Or from source:

```bash
pi install git:github.com/andrea-tomassi/pi-power-toys
```

Or try without installing:

```bash
pi -e npm:pi-power-toys
```

## Usage

### `/power-settings`

Opens an interactive toggle menu for all available features. Changes apply immediately and are saved to `~/.pi/agent/pi-power-toys.json`.

### Features

| Feature | Default | Description |
|---------|---------|-------------|
| **Yellow Session Name** | on | Shows named sessions in yellow in the footer, matching the session picker color |
| **Fix Chrome Display** | on | Starts Xvfb virtual display so Chrome can launch on machines without a physical display |
| **Compact Model** | off | Use a specific model for context compaction, independent of the active conversation model. Shows a model picker in /power-settings. Falls back to the session model if the configured model is unavailable |

## Adding a New Power Toy

### 1. Create a feature file

Add a new file in `src/features/`:

```ts
// src/features/my-feature.ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types";

export const myFeature: PowerToyFeature = {
  id: "my-feature",                // unique kebab-case id (used as config key)
  label: "My Feature",             // display name in /power-settings
  description: "What it does",     // one-line description
  defaultValue: true,              // enabled by default?

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // Called when the feature is toggled on or on session_start if enabled.
    // Register hooks, override UI, attach listeners, etc.
  },

  disable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // Called when the feature is toggled off.
    // Clean up: remove listeners, restore defaults, etc.
  },
};
```

### 2. Register it

Add the import and entry in `src/index.ts`:

```ts
import { myFeature } from "./features/my-feature";

const features: PowerToyFeature[] = [
  yellowSessionName,
  myFeature,  // ← add here
];
```

That's it — `/power-settings` will automatically show the new toggle, and it'll activate on the next session start (or immediately if toggled on).

### 3. Build & test

```bash
npm run build          # compile to dist/
# then restart pi or /reload
```

### API Quick Reference

Common `ExtensionContext` and `ExtensionAPI` methods:

| API | Description |
|-----|-------------|
| `ctx.ui.setFooter(factory)` | Override the footer. Pass `undefined` to restore the default. |
| `ctx.ui.notify(msg, level)` | Show a notification (`"info"`, `"warning"`, `"error"`). |
| `ctx.ui.custom(builder)` | Render a custom fullscreen UI (for settings menus, etc.). |
| `ctx.sessionManager` | Access session name, cwd, entries, and session lifecycle. |
| `ctx.model` / `ctx.modelRegistry` | Current model info and provider queries. |
| `ctx.getContextUsage()` | Context window usage stats. |
| `pi.on(event, handler)` | Listen to pi events (`session_start`, `message_complete`, etc.). |
| `pi.registerCommand(name, def)` | Register a `/command` with description and handler. |
| `pi.registerTool(name, def)` | Register a tool that the LLM can call. |
| `pi.getThinkingLevel()` | Get the current thinking/reasoning level. |

### Config

Settings are persisted in `~/.pi/agent/pi-power-toys.json`:

```json
{
  "yellow-session-name": true,
  "my-feature": false
}
```

Read/write via `src/config.ts` helpers:

```ts
import { loadConfig, saveConfig } from "./config";

const cfg = await loadConfig();    // { "yellow-session-name": true, ... }
cfg["my-feature"] = true;
await saveConfig(cfg);             // atomic write
```

## Project Structure

```
pi-power-toys/
├── package.json            # npm + pi manifest (pi-package keyword, pi.extensions)
├── tsconfig.json           # ESM, Node 20+, strict
├── .gitignore
├── README.md
├── src/
│   ├── index.ts            # Entry point — loads config, registers /power-settings, enables features
│   ├── config.ts           # Persist/load settings from ~/.pi/agent/pi-power-toys.json
│   ├── types.ts            # PowerToyFeature interface
│   └── features/
│       └── yellow-session-name.ts  # Feature: yellow session names in footer
└── dist/                   # build output (gitignored)
```

## Publishing

```bash
npm run prepublishOnly   # typecheck + build
npm publish              # publishes dist/ only (see "files" in package.json)
```

The `"pi-package"` keyword in `package.json` makes this appear on [pi.dev/packages](https://pi.dev/packages).

## License

MIT
