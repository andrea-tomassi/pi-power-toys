<div align="center">

# ⚡ Pi Power Toys

**Power-user customizations for the [Pi](https://pi.dev) coding agent**

Yellow session names, dedicated compaction models, hostname in the footer —
small, focused features that Pi doesn't ship natively.

[![npm version](https://img.shields.io/npm/v/pi-power-toys.svg)](https://www.npmjs.com/package/pi-power-toys)
[![CI](https://github.com/andrea-tomassi/pi-power-toys/actions/workflows/ci.yml/badge.svg)](https://github.com/andrea-tomassi/pi-power-toys/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![pi](https://img.shields.io/badge/pi-coding%20agent-blue)](https://pi.dev)

</div>

---

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

## Features

Each feature is independently toggleable via `/power-settings` and persists across restarts.

### 🟡 Yellow Session Name

Shows named sessions in yellow in the footer, matching the session picker color.
No more guessing which session you're in.

```
~/external-projects (main) • my-feature-work
                       ^^^^^^^^^^^^^^^^^^^^ yellow
```

### 🧠 Compact Model

Use a dedicated model for context compaction, independent of the active conversation model.

- Run your conversation on a strong model, compact on a cheaper one
- Model picker integrated into `/power-settings`
- Falls back to the session model if the configured model is unavailable

### 🖥️ Hostname in Footer

Shows the machine hostname in the footer status line — instantly know which
machine you're coding on when working across multiple hosts.

## Usage

Type `/power-settings` in Pi to open the interactive toggle menu:

```
Power Toys Settings

  🟡 Yellow Session Name          [ON]
  🧠 Compact Model                [off]
  🖥️ Hostname in Footer           [ON]
```

Changes apply immediately and are saved to `~/.pi/agent/pi-power-toys.json`.

### Config

```json
{
  "yellow-session-name": true,
  "compact-model": "off",
  "hostname-footer": true
}
```

`compact-model` accepts a `"provider:model_id"` string instead of a boolean.

## Development

```bash
git clone https://github.com/andrea-tomassi/pi-power-toys.git
cd pi-power-toys
npm install

npm test           # run unit tests
npm run typecheck  # tsc --noEmit
```

Pi loads extensions from TypeScript source via jiti — no build step needed.

### Adding a New Feature

1. **Create** `src/features/my-feature.ts` implementing the `PowerToyFeature` interface:

```ts
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types";

export const myFeature: PowerToyFeature = {
  id: "my-feature",
  label: "My Feature",
  description: "What it does",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // Register hooks, override UI, attach listeners, etc.
  },

  disable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // Clean up: remove listeners, restore defaults, etc.
  },
};
```

2. **Register** it in `src/index.ts`:

```ts
import { myFeature } from "./features/my-feature";

const features: PowerToyFeature[] = [
  yellowSessionName,
  myFeature,  // ← add here
];
```

`/power-settings` picks it up automatically.

### Release

```bash
npm version patch    # or minor / major
git push origin main --follow-tags
```

This triggers the GitHub Actions publish pipeline (npm Trusted Publishing with
OIDC, no token needed). See [CHANGELOG.md](CHANGELOG.md) for release history.

## Feature Requests

Have an idea for a new power toy? We'd love to hear it!

👉 **[Open a feature request](https://github.com/andrea-tomassi/pi-power-toys/issues/new?template=feature_request.md)**

Or browse existing ideas and vote on the [issues board](https://github.com/andrea-tomassi/pi-power-toys/issues?q=label%3Aenhancement).

## License

[MIT](LICENSE) © Andrea Tomassi
