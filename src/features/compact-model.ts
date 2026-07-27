import { complete } from "@earendil-works/pi-ai";
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
    pi.on("session_before_compact", async (event, ctx) => {
      const { preparation, signal } = event;
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
      const modelKey = typeof raw === "string" ? raw : undefined;

      // If not set to a string (could be true/false), skip — use default compaction
      if (typeof modelKey !== "string") return;

      const parsed = parseModelKey(modelKey);
      if (!parsed) {
        ctx.ui.notify(
          `[compact-model] Invalid model key "${modelKey}", expected "provider:model_id". Falling back to default.`,
          "warning",
        );
        return;
      }

      const [provider, modelId] = parsed;

      // Resolve the model from registry
      let model = ctx.modelRegistry.find(provider, modelId);

      // Fallback to session model if configured model not found
      if (!model) {
        if (ctx.model) {
          ctx.ui.notify(
            `[compact-model] "${modelKey}" not found. Falling back to session model ${ctx.model.provider}:${ctx.model.id}`,
            "warning",
          );
          model = ctx.model;
        } else {
          ctx.ui.notify(
            `[compact-model] "${modelKey}" not found and no session model available. Using default compaction.`,
            "warning",
          );
          return;
        }
      }

      // Check auth
      const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
      if (!auth.ok) {
        // Try fallback to session model
        if (model !== ctx.model && ctx.model) {
          ctx.ui.notify(
            `[compact-model] No auth for ${model.provider}:${model.id}. Falling back to session model.`,
            "warning",
          );
          model = ctx.model;
          const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!fallbackAuth.ok || !fallbackAuth.apiKey) {
            ctx.ui.notify(
              `[compact-model] No auth for fallback model either. Using default compaction.`,
              "warning",
            );
            return;
          }
        } else {
          ctx.ui.notify(
            `[compact-model] Auth failed: ${auth.error}. Using default compaction.`,
            "warning",
          );
          return;
        }
      } else if (!auth.apiKey && !ctx.modelRegistry.isUsingOAuth(model)) {
        // No API key and not OAuth — try fallback
        if (model !== ctx.model && ctx.model) {
          ctx.ui.notify(
            `[compact-model] No API key for ${model.provider}:${model.id}. Falling back to session model.`,
            "warning",
          );
          model = ctx.model;
          const fallbackAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
          if (!fallbackAuth.ok || !fallbackAuth.apiKey) {
            ctx.ui.notify(
              `[compact-model] No auth for fallback model. Using default compaction.`,
              "warning",
            );
            return;
          }
        } else {
          ctx.ui.notify(
            `[compact-model] No API key for ${model.provider}:${model.id}. Using default compaction.`,
            "warning",
          );
          return;
        }
      }

      const displayKey = `${model.provider}:${model.id}`;
      const allMessages = [...messagesToSummarize, ...turnPrefixMessages];

      ctx.ui.notify(
        `[compact-model] Compacting ${tokensBefore.toLocaleString()} tokens with ${displayKey}...`,
        "info",
      );

      // Serialize conversation
      const conversationText = serializeConversation(convertToLlm(allMessages));

      // Guard: if serialization is empty, fall back to default compaction.
      // This happens when findCutPoint keeps nearly everything and
      // the entries before the cut are all metadata (model_change,
      // thinking_level_change, etc.) with no summarizable content.
      if (!conversationText.trim()) {
        ctx.ui.notify(
          `[compact-model] Serialized conversation is empty (${tokensBefore.toLocaleString()} tokens reported, ${allMessages.length} messages). Falling back to default compaction.`,
          "warning",
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

      try {
        const finalAuth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        const response = await complete(
          model,
          { messages: summaryMessages },
          {
            apiKey: finalAuth.ok ? finalAuth.apiKey : undefined,
            headers: finalAuth.ok ? finalAuth.headers : undefined,
            maxTokens: 8192,
            signal,
          },
        );

        const summary = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("\n");

        if (!summary.trim()) {
          if (!signal.aborted)
            ctx.ui.notify(
              `[compact-model] Summary was empty. Using default compaction.`,
              "warning",
            );
          return;
        }

        ctx.ui.notify(`[compact-model] ✓ Compaction complete (${displayKey})`, "info");

        return {
          compaction: {
            summary,
            firstKeptEntryId,
            tokensBefore,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(
          `[compact-model] Compaction failed: ${message}. Falling back to default.`,
          "warning",
        );
        return;
      }
    });
  },

  disable() {
    // Handler is session-scoped; no cleanup needed
  },
};
