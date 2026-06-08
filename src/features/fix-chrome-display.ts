import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execSync, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { PowerToyFeature } from "../types.js";

let xvfbProcess: ChildProcess | null = null;

/**
 * Starts a virtual X server (Xvfb) so Chrome can launch in headless environments.
 *
 * Problem: pi-chrome-dev-tools launches Chrome in headed mode (headless: false).
          On machines without a physical display ($DISPLAY unset), Chrome fails
          with "Missing X server or $DISPLAY" and the extension returns the
          misleading "Chrome not found" error.

 * Fix: Start Xvfb on display :99 and set process.env.DISPLAY.
 *       Idempotent — skips if DISPLAY is already set or Xvfb is already running.
 */
function startXvfb(): boolean {
  if (process.env.DISPLAY) return false; // already have a display

  try {
    execSync("which Xvfb", { encoding: "utf-8" });
  } catch {
    return false; // Xvfb not installed
  }

  // Check if :99 is already taken
  try {
    execSync("xdpyinfo -display :99", { encoding: "utf-8", timeout: 2000 });
    // Display :99 exists — just set the env var
    process.env.DISPLAY = ":99";
    return true;
  } catch {
    // :99 not available — start it
  }

  try {
    xvfbProcess = spawn("Xvfb", [":99", "-screen", "0", "1280x1024x24", "-ac"], {
      stdio: "ignore",
      detached: true,
    });
    xvfbProcess.unref();

    // Give Xvfb a moment to start
    const start = Date.now();
    while (Date.now() - start < 2000) {
      try {
        execSync("xdpyinfo -display :99", { encoding: "utf-8", timeout: 500 });
        break;
      } catch {
        // retry
      }
    }

    process.env.DISPLAY = ":99";
    return true;
  } catch {
    return false;
  }
}

export const fixChromeDisplay: PowerToyFeature = {
  id: "fix-chrome-display",
  label: "Fix Chrome Display",
  description:
    "Start Xvfb virtual display so pi-chrome-dev-tools can launch Chrome on machines without a physical display",
  defaultValue: true,

  enable(pi: ExtensionAPI, _ctx: ExtensionContext) {
    const started = startXvfb();
    if (started) {
      pi.on("session_shutdown", () => {
        if (xvfbProcess) {
          xvfbProcess.kill();
          xvfbProcess = null;
        }
      });
    }
  },

  disable() {
    if (xvfbProcess) {
      xvfbProcess.kill();
      xvfbProcess = null;
    }
    // Don't unset DISPLAY — might break things mid-session
  },
};
