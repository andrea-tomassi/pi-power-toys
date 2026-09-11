import { uuidv7 } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import type { PowerToyFeature } from "../types.ts";
import { loadConfig } from "../config.ts";
import { parseModelKey } from "./parse-model-key.ts";

export const compactModel: PowerToyFeature = {
  id: "compact-model",
  label: "Compact Model",
  description:
    "Use a specific model for context compaction, independent of the active conversation model",
  defaultValue: false,

  enable(pi: ExtensionAPI, ctx: ExtensionContext) {
    // Dedupe identical warnings within a short window — overflow recovery may
    // re-fire this handler several times in quick succession.
    let lastWarning = "";
    let lastWarningAt = 0;
    const warn = (msg: string) => {
      const now = Date.now();
      if (msg === lastWarning && now - lastWarningAt < 5000) return;
      lastWarning = msg;
      lastWarningAt = now;
      ctx.ui.notify(msg, "warning");
    };

    pi.on("session_before_compact", async (event, ctx) => {
      const { preparation, signal, reason } = event;
      const {
        messagesToSummarize,
        turnPrefixMessages,
        tokensBefore,
        firstKeptEntryId,
        previousSummary,
      } = preparation;

      // Read the configured compact model from power-toys config
      const cfg = await loadConfig();
      const raw = cfg["compact-model"];

      // "off" (or non-string) means the feature is disabled — silent exit.
      // Overflow recovery may re-fire this handler after the user toggled
      // the feature off mid-recovery; that is not an error.
      const modelKey = typeof raw === "string" && raw !== "off" ? raw : undefined;
      if (typeof modelKey !== "string") return;

      const reasonLabel =
        reason === "manual"
          ? "manual"
          : reason === "threshold"
            ? "context threshold"
            : "overflow recovery";

      const parsed = parseModelKey(modelKey);
      if (!parsed) {
        warn(
          `[compact-model] Invalid model key "${modelKey}", expected "provider:model_id". Falling back to default compaction.`,
        );
        return;
      }

      const [provider, modelId] = parsed;

      // Resolve the model from registry
      let model = ctx.modelRegistry.find(provider, modelId);

      // Fallback to session model if configured model not found
      if (!model) {
        if (ctx.model) {
          warn(
            `[compact-model] "${modelKey}" not found → falling back to session model ${ctx.model.provider}:${ctx.model.id}`,
          );
          model = ctx.model;
        } else {
          warn(
            `[compact-model] "${modelKey}" not found and no session model available → using default compaction.`,
          );
          return;
        }
      }

      // Check auth
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        // Try fallback to session model
        if (model !== ctx.model && ctx.model) {
          warn(
            `[compact-model] No auth for ${model.provider}:${model.id} → falling back to session model.`,
          );
          model = ctx.model;
          const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!fallbackAuth.ok || !fallbackAuth.apiKey) {
            warn(`[compact-model] No auth for fallback model either → using default compaction.`);
            return;
          }
        } else {
          warn(`[compact-model] Auth failed: ${auth.error} → using default compaction.`);
          return;
        }
      } else if (!auth.apiKey && !ctx.modelRegistry.isUsingOAuth(model)) {
        // No API key and not OAuth — try fallback
        if (model !== ctx.model && ctx.model) {
          warn(
            `[compact-model] No API key for ${model.provider}:${model.id} → falling back to session model.`,
          );
          model = ctx.model;
          const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!fallbackAuth.ok || !fallbackAuth.apiKey) {
            warn(`[compact-model] No auth for fallback model → using default compaction.`);
            return;
          }
        } else {
          warn(
            `[compact-model] No API key for ${model.provider}:${model.id} → using default compaction.`,
          );
          return;
        }
      }

      const displayKey = `${model.provider}:${model.id}`;
      const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

      ctx.ui.notify(
        `[compact-model] Compacting ${tokensBefore.toLocaleString()} tokens with ${displayKey} (${reasonLabel})...`,
        "info",
      );

      // Serialize conversation
      const conversationText = serializeConversation(convertToLlm(allMessages));

      // Guard: if serialization is empty, fall back to default compaction.
      // This happens when findCutPoint keeps nearly everything and
      // the entries before the cut are all metadata (model_change,
      // thinking_level_change, etc.) with no summarizable content.
      if (!conversationText.trim()) {
        warn(
          `[compact-model] Serialized conversation is empty (${tokensBefore.toLocaleString()} tokens reported, ${allMessages.length} messages) → falling back to default compaction.`,
        );
        return;
      }

      const previousContext = previousSummary
        ? `\n\nPrevious session summary for context:\n${previousSummary}`
        : "";

      const summaryMessages = [
        {
          role: "user" as const,
          content: [
            {
              type: "text" as const,
              text: `You are a conversation summarizer. Create a comprehensive summary of this conversation that captures:${previousContext}

1. The main goals and objectives discussed
2. Key decisions made and their rationale
3. Important code changes, file modifications, or technical details
4. Current state of any ongoing work
5. Any blockers, issues, or open questions
6. Next steps that were planned or suggested

Be thorough but concise. The summary will replace older conversation history, so include all information needed to continue the work effectively.

Format the summary as structured markdown with clear sections.

<conversation>
${conversationText}
</conversation>`,
            },
          ],
          timestamp: Date.now(),
        },
      ];

      // opencode-go gateway ("Console Go") requires attribution headers for correct
      // upstream routing — without x-opencode-client the model is reported unavailable.
      // The agent runtime injects these via mergeProviderAttributionHeaders
      // (core/provider-attribution.js); complete() does not, so we add them here.
      const compactSessionId = uuidv7();
      const isOpencodeProvider =
        model.provider === "opencode" ||
        model.provider === "opencode-go" ||
        (typeof model.baseUrl === "string" && model.baseUrl.includes("opencode.ai"));
      const attributionHeaders = isOpencodeProvider
        ? { "x-opencode-client": "pi", "x-opencode-session": compactSessionId }
        : undefined;

      try {
        const response = await ctx.modelRegistry.complete(
          model,
          { messages: summaryMessages },
          {
            maxTokens: 8192,
            signal,
            cacheRetention: "none",
            sessionId: compactSessionId,
            headers: attributionHeaders,
          },
        );

        // Surface the real upstream error instead of a misleading "empty summary"
        if (response.stopReason === "error") {
          if (!signal.aborted) {
            const errMsg = response.errorMessage;
            warn(
              `[compact-model] Model error (${displayKey}): ${errMsg ?? "unknown error"} → using default compaction.`,
            );
          }
          return;
        }

        const summary = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        if (!summary.trim()) {
          if (!signal.aborted) {
            const blockTypes =
              response.content.map((c) => c.type).join(", ") || "(none)";
            warn(
              `[compact-model] Summary was empty (stopReason: ${response.stopReason}, blocks: [${blockTypes}]) → using default compaction.`,
            );
          }
          return;
        }

        ctx.ui.notify(`[compact-model] ✓ Compaction complete (${displayKey})`, "info");

        return {
          compaction: {
            summary,
            firstKeptEntryId,
            tokensBefore,
            usage: response.usage,
          },
        };
      } catch (error) {
        if (signal.aborted) return; // user cancelled — not an error
        const message = error instanceof Error ? error.message : String(error);
        warn(`[compact-model] Compaction failed: ${message} → falling back to default.`);
        return;
      }
    });
  },

  disable() {
    // Handler is session-scoped; no cleanup needed
  },
};
