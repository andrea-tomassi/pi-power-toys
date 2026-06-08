import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.js";

/**
 * PoC: On startup, if named (yellow) sessions exist, show a wizard
 * to resume one or start fresh.
 *
 * Strategy:
 * - session_start: detect named sessions, show a hint notification
 * - /session-wizard command: interactive picker using ctx.ui.select()
 *
 * Limitation: session_start context (ExtensionContext) doesn't have
 * switchSession(). Only command context (ExtensionCommandContext) does.
 * So the wizard must be a command. The startup hook shows a reminder.
 */
export const sessionResumeWizard: PowerToyFeature = {
  id: "session-resume-wizard",
  label: "Session Resume Wizard",
  description:
    "On startup, show a wizard to resume a named (yellow) session or start fresh",
  defaultValue: false,

  enable(pi: ExtensionAPI, _ctx: ExtensionContext) {
    // Startup hook: detect named sessions and show hint
    pi.on("session_start", async (event, ctx) => {
      if (event.reason !== "startup") return;
      if (ctx.mode !== "tui") return;

      try {
        const cwd = ctx.sessionManager.getCwd();
        const sessions = await SessionManager.list(cwd);
        const named = sessions.filter(
          (s) => s.name && s.name.trim().length > 0,
        );

        if (named.length > 0) {
          const names = named.map((s) => `"${s.name}"`).join(", ");
          ctx.ui.notify(
            `⚡ ${named.length} named session(s) available: ${names} — type /session-wizard to resume`,
            "info",
          );
        }
      } catch {
        // Silent — don't break startup
      }
    });

    // Command: interactive session picker with switchSession()
    pi.registerCommand("session-wizard", {
      description: "Resume a named (yellow) session or start fresh",
      handler: async (_args, ctx) => {
        if (ctx.mode !== "tui") return;

        const cwd = ctx.sessionManager.getCwd();
        const sessions = await SessionManager.list(cwd);
        const named = sessions.filter(
          (s) => s.name && s.name.trim().length > 0,
        );

        if (named.length === 0) {
          ctx.ui.notify("No named sessions found. Use /name to name a session first.", "info");
          return;
        }

        // Build options: named sessions + "new session" + "cancel"
        const options = [
          ...named.map((s) => {
            const date = s.modified.toLocaleString("en", {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });
            return {
              label: `📂 ${s.name}  (${date}, ${s.messageCount} msgs)`,
              value: s.path,
            };
          }),
          { label: "🆕 New session", value: "__new__" },
          { label: "❌ Cancel", value: "__cancel__" },
        ];

        const labels = options.map((o) => o.label);
        const choice = await ctx.ui.select("Resume a session:", labels);

        if (!choice) {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        const selected = options.find((o) => o.label === choice);

        if (!selected || selected.value === "__cancel__") {
          ctx.ui.notify("Cancelled", "info");
          return;
        }

        if (selected.value === "__new__") {
          const result = await ctx.newSession({
            withSession: async (newCtx) => {
              newCtx.ui.notify("✓ New session started", "info");
            },
          });
          if (result.cancelled) {
            ctx.ui.notify("New session cancelled", "info");
          }
          return;
        }

        // Resume named session
        const sessionName = selected.label;
        const result = await ctx.switchSession(selected.value, {
          withSession: async (newCtx) => {
            newCtx.ui.notify(`✓ Resumed: ${sessionName}`, "info");
          },
        });
        if (result.cancelled) {
          ctx.ui.notify("Session switch cancelled", "info");
        }
      },
    });
  },

  disable(_pi: ExtensionAPI, _ctx: ExtensionContext) {
    // No-op
  },
};
