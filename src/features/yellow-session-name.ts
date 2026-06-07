import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { PowerToyFeature } from "../types.js";

// --- Helpers (mirrors built-in footer utils) ---

function formatCwdForFooter(cwd: string, home: string): string {
  if (!home) return cwd;
  const resolvedCwd = resolve(cwd);
  const resolvedHome = resolve(home);
  const rel = relative(resolvedHome, resolvedCwd);
  const isInside =
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  if (!isInside) return cwd;
  return rel === "" ? "~" : `~${sep}${rel}`;
}

function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${Math.round(count / 1_000_000)}M`;
}

function sanitizeStatusText(text: string): string {
  return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

// --- Feature ---

export const yellowSessionName: PowerToyFeature = {
  id: "yellow-session-name",
  label: "Yellow Session Name",
  description:
    "Show named sessions in yellow in the footer, matching the session picker color",
  defaultValue: true,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsub = footerData.onBranchChange(() => tui.requestRender());

      return {
        dispose: unsub,
        invalidate() {},

        render(width: number): string[] {
          const home = process.env.HOME || process.env.USERPROFILE || "";

          // --- Token stats (all entries, not just post-compaction) ---
          let totalInput = 0;
          let totalOutput = 0;
          let totalCacheRead = 0;
          let totalCacheWrite = 0;
          let totalCost = 0;

          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message" && entry.message.role === "assistant") {
              const m = entry.message as AssistantMessage;
              totalInput += m.usage.input;
              totalOutput += m.usage.output;
              totalCacheRead += m.usage.cacheRead;
              totalCacheWrite += m.usage.cacheWrite;
              totalCost += m.usage.cost.total;
            }
          }

          // --- Context usage ---
          const contextUsage = ctx.getContextUsage();
          const contextWindow =
            contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const contextPercentValue = contextUsage?.percent ?? 0;
          const contextPercent =
            contextUsage?.percent !== null && contextUsage?.percent !== undefined
              ? contextPercentValue.toFixed(1)
              : "?";

          // --- Line 1: cwd + git branch + session name (yellow!) ---
          let pwdPart = formatCwdForFooter(ctx.sessionManager.getCwd(), home);
          const branch = footerData.getGitBranch();
          if (branch) pwdPart += ` (${branch})`;

          const sessionName = ctx.sessionManager.getSessionName();

          let line1: string;
          if (sessionName) {
            const dimPwd = theme.fg("dim", pwdPart + " \u2022 ");
            const coloredName = theme.fg("warning", sessionName);
            line1 = truncateToWidth(dimPwd + coloredName, width, theme.fg("dim", "\u2026"));
          } else {
            line1 = truncateToWidth(theme.fg("dim", pwdPart), width, theme.fg("dim", "\u2026"));
          }

          // --- Line 2: stats + model ---
          const statsParts: string[] = [];
          if (totalInput) statsParts.push(`\u2191${formatTokens(totalInput)}`);
          if (totalOutput) statsParts.push(`\u2193${formatTokens(totalOutput)}`);
          if (totalCacheRead) statsParts.push(`R${formatTokens(totalCacheRead)}`);
          if (totalCacheWrite) statsParts.push(`W${formatTokens(totalCacheWrite)}`);

          const usingSubscription = ctx.model
            ? ctx.modelRegistry.isUsingOAuth(ctx.model)
            : false;
          if (totalCost || usingSubscription) {
            const costStr = `$${totalCost.toFixed(3)}${usingSubscription ? " (sub)" : ""}`;
            statsParts.push(costStr);
          }

          // Context % with color coding
          const autoIndicator = " (auto)";
          const contextPercentDisplay =
            contextPercent === "?"
              ? `?/${formatTokens(contextWindow)}${autoIndicator}`
              : `${contextPercent}%/${formatTokens(contextWindow)}${autoIndicator}`;

          let contextPercentStr: string;
          if (contextPercentValue > 90) {
            contextPercentStr = theme.fg("error", contextPercentDisplay);
          } else if (contextPercentValue > 70) {
            contextPercentStr = theme.fg("warning", contextPercentDisplay);
          } else {
            contextPercentStr = contextPercentDisplay;
          }
          statsParts.push(contextPercentStr);

          let statsLeft = statsParts.join(" ");
          let statsLeftWidth = visibleWidth(statsLeft);
          if (statsLeftWidth > width) {
            statsLeft = truncateToWidth(statsLeft, width, "...");
            statsLeftWidth = visibleWidth(statsLeft);
          }

          // Right side: model name + thinking level
          const modelName = ctx.model?.id || "no-model";
          const thinkingLevel = pi.getThinkingLevel();
          let rightSide = modelName;
          if (ctx.model?.reasoning) {
            rightSide =
              thinkingLevel === "off"
                ? `${modelName} \u2022 thinking off`
                : `${modelName} \u2022 ${thinkingLevel}`;
          }

          // Provider prefix when multiple providers
          if (footerData.getAvailableProviderCount() > 1 && ctx.model) {
            const withProvider = `(${ctx.model.provider}) ${rightSide}`;
            if (statsLeftWidth + 2 + visibleWidth(withProvider) <= width) {
              rightSide = withProvider;
            }
          }

          const rightSideWidth = visibleWidth(rightSide);
          const totalNeeded = statsLeftWidth + 2 + rightSideWidth;
          const dimStatsLeft = theme.fg("dim", statsLeft);

          let statsLine: string;
          if (totalNeeded <= width) {
            const padding = " ".repeat(width - statsLeftWidth - rightSideWidth);
            statsLine = dimStatsLeft + theme.fg("dim", padding + rightSide);
          } else {
            const availableForRight = width - statsLeftWidth - 2;
            if (availableForRight > 0) {
              const truncatedRight = truncateToWidth(rightSide, availableForRight, "");
              const trWidth = visibleWidth(truncatedRight);
              const padding = " ".repeat(Math.max(0, width - statsLeftWidth - trWidth));
              statsLine = dimStatsLeft + theme.fg("dim", padding + truncatedRight);
            } else {
              statsLine = dimStatsLeft;
            }
          }

          const lines = [line1, statsLine];

          // --- Line 3: extension statuses ---
          const extensionStatuses = footerData.getExtensionStatuses();
          if (extensionStatuses.size > 0) {
            const sortedStatuses = Array.from(extensionStatuses.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([, text]) => sanitizeStatusText(text));
            const statusLine = sortedStatuses.join(" ");
            lines.push(truncateToWidth(statusLine, width, theme.fg("dim", "\u2026")));
          }

          return lines;
        },
      };
    });
  },

  disable(_pi: ExtensionAPI, ctx: ExtensionContext) {
    ctx.ui.setFooter(undefined);
  },
};
