import { hostname } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.js";

// --- Helpers (not exported by pi-coding-agent) ---

function formatCwdForFooter(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const relativeToHome = relative(resolvedHome, resolvedCwd);
  const isInsideHome =
    relativeToHome === "" ||
    (relativeToHome !== ".." &&
      !relativeToHome.startsWith(`..${sep}`) &&
      !isAbsolute(relativeToHome));
  if (!isInsideHome) return cwd;
  return relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// --- Feature ---

let hostnameCache: string | undefined;

export const customFooter: PowerToyFeature = {
  id: "custom-footer",
  label: "Custom Footer",
  description: "Show hostname before folder path in the footer",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;

    // Capture hostname once
    if (!hostnameCache) {
      hostnameCache = hostname();
    }

    pi.on("session_start", async (_event, sctx) => {
      if (sctx.mode !== "tui") return;

      sctx.ui.setFooter((_tui, theme, footerData) => {
        // We can't create a FooterComponent (needs AgentSession),
        // so we build a minimal footer from extension API data.

        return {
          render(width: number): string[] {
            const sessionMgr = sctx.sessionManager;
            const cwd = sessionMgr.getCwd();
            const entries = sessionMgr.getEntries();

            // --- Token stats ---
            let totalInput = 0;
            let totalOutput = 0;
            let totalCacheRead = 0;
            let totalCacheWrite = 0;
            let totalCost = 0;
            let latestCacheHitRate: number | undefined;

            for (const entry of entries) {
              if (entry.type === "message" && entry.message.role === "assistant") {
                const u = entry.message.usage;
                totalInput += u.input;
                totalOutput += u.output;
                totalCacheRead += u.cacheRead;
                totalCacheWrite += u.cacheWrite;
                totalCost += u.cost.total;
                const promptTokens = u.input + u.cacheRead + u.cacheWrite;
                latestCacheHitRate =
                  promptTokens > 0 ? (u.cacheRead / promptTokens) * 100 : undefined;
              }
            }

            // --- Pwd line: hostname (blue) + folder (dim) ---
            let pwd = formatCwdForFooter(
              cwd,
              process.env.HOME || process.env.USERPROFILE,
            );
            const branch = footerData.getGitBranch();
            if (branch) pwd = `${pwd} (${branch})`;
            const sessionName = sessionMgr.getSessionName();
            if (sessionName) pwd = `${pwd} • ${sessionName}`;

            const hostStr = theme.fg("accent", `${hostnameCache}`);
            const pwdLine = truncateToWidth(
              `${hostStr} ${theme.fg("dim", pwd)}`,
              width,
              theme.fg("dim", "..."),
            );

            // --- Stats line ---
            const statsParts: string[] = [];
            if (totalInput) statsParts.push(`↑${formatTokens(totalInput)}`);
            if (totalOutput) statsParts.push(`↓${formatTokens(totalOutput)}`);
            if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
            if (totalCacheWrite)
              statsParts.push(`W${formatTokens(totalCacheWrite)}`);
            if (
              (totalCacheRead > 0 || totalCacheWrite > 0) &&
              latestCacheHitRate !== undefined
            ) {
              statsParts.push(`CH${latestCacheHitRate.toFixed(1)}%`);
            }
            if (totalCost) {
              statsParts.push(`$${totalCost.toFixed(3)}`);
            }

            // Context usage — not available via extension API, show as "?"
            statsParts.push("?");

            let statsLeft = statsParts.join(" ");
            let statsLeftWidth = visibleWidth(statsLeft);
            if (statsLeftWidth > width) {
              statsLeft = truncateToWidth(statsLeft, width, "...");
              statsLeftWidth = visibleWidth(statsLeft);
            }

            // Model name on right side
            const modelName = sctx.model?.id || "no-model";
            let rightSide = modelName;
            const minPadding = 2;
            const rightSideWidth = visibleWidth(rightSide);
            const totalNeeded = statsLeftWidth + minPadding + rightSideWidth;

            let statsLine: string;
            if (totalNeeded <= width) {
              const padding = " ".repeat(
                width - statsLeftWidth - rightSideWidth,
              );
              statsLine = statsLeft + padding + rightSide;
            } else {
              const availableForRight = width - statsLeftWidth - minPadding;
              if (availableForRight > 0) {
                const truncatedRight = truncateToWidth(
                  rightSide,
                  availableForRight,
                  "",
                );
                const truncatedRightWidth = visibleWidth(truncatedRight);
                const padding = " ".repeat(
                  Math.max(0, width - statsLeftWidth - truncatedRightWidth),
                );
                statsLine = statsLeft + padding + truncatedRight;
              } else {
                statsLine = statsLeft;
              }
            }

            const dimStatsLeft = theme.fg("dim", statsLeft);
            const remainder = statsLine.slice(statsLeft.length);
            const dimRemainder = theme.fg("dim", remainder);

            const lines = [pwdLine, dimStatsLeft + dimRemainder];

            // Extension statuses
            const extStatuses = footerData.getExtensionStatuses();
            if (extStatuses.size > 0) {
              const sorted = Array.from(extStatuses.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([, text]) => sanitizeStatusText(text));
              const statusLine = sorted.join(" ");
              lines.push(
                truncateToWidth(statusLine, width, theme.fg("dim", "...")),
              );
            }

            return lines;
          },
          invalidate() {},
          dispose() {},
        };
      });
    });
  },

  disable(_pi: ExtensionAPI, ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    // Restore built-in footer
    ctx.ui.setFooter(undefined);
  },
};
