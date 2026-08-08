import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseModelKey } from "./parse-model-key.ts";
import { compactModel } from "./compact-model.ts";

const { loadConfigMock } = vi.hoisted(() => ({ loadConfigMock: vi.fn() }));

vi.mock("../config.ts", () => ({
  loadConfig: loadConfigMock,
}));

describe("parseModelKey", () => {
  it("parses a valid provider:model_id key", () => {
    expect(parseModelKey("anthropic:claude-sonnet-4-20250514")).toEqual([
      "anthropic",
      "claude-sonnet-4-20250514",
    ]);
  });

  it("parses a key with multiple colons in the model id", () => {
    expect(parseModelKey("ollama:qwen3:32b-instruct")).toEqual(["ollama", "qwen3:32b-instruct"]);
  });

  it("returns null when there is no colon", () => {
    expect(parseModelKey("invalid")).toBeNull();
  });

  it("returns null when provider is empty", () => {
    expect(parseModelKey(":model-id")).toBeNull();
  });

  it("returns null when model id is empty", () => {
    expect(parseModelKey("provider:")).toBeNull();
  });
});

describe("compactModel session_before_compact handler", () => {
  let handler: ((event: any, ctx: any) => Promise<any>) | undefined;
  let notifyMock: ReturnType<typeof vi.fn>;
  let completeMock: ReturnType<typeof vi.fn>;
  let ctx: ExtensionContext;

  const model = { provider: "anthropic", id: "claude-sonnet-4-20250514" };

  beforeEach(() => {
    loadConfigMock.mockReset();
    loadConfigMock.mockResolvedValue({ "compact-model": "anthropic:claude-sonnet-4-20250514" });

    handler = undefined;
    notifyMock = vi.fn();
    completeMock = vi.fn();

    const pi = {
      on: vi.fn((event: string, h: any) => {
        if (event === "session_before_compact") handler = h;
      }),
    } as unknown as ExtensionAPI;

    ctx = {
      ui: { notify: notifyMock },
      model: undefined,
      modelRegistry: {
        find: vi.fn(() => model),
        getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-key" })),
        isUsingOAuth: vi.fn(() => false),
        complete: completeMock,
      },
    } as unknown as ExtensionContext;

    compactModel.enable(pi, ctx);
  });

  const makeEvent = () => ({
    type: "session_before_compact",
    preparation: {
      firstKeptEntryId: "entry-keep-1",
      messagesToSummarize: [{ role: "user", content: "Hello there", timestamp: 1 }],
      turnPrefixMessages: [],
      isSplitTurn: false,
      tokensBefore: 1234,
      fileOps: { read: new Set(), written: new Set(), edited: new Set() },
      settings: { enabled: true, reserveTokens: 4096, keepRecentTokens: 20480 },
    },
    branchEntries: [],
    reason: "threshold",
    willRetry: false,
    signal: new AbortController().signal,
  });

  it("calls ctx.modelRegistry.complete and maps a text-block response to a non-empty summary", async () => {
    completeMock.mockResolvedValue({
      role: "assistant",
      content: [{ type: "text", text: "This is the summary" }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const result = await handler!(makeEvent(), ctx);

    // The completion must go through the registry (which runs prepareRequest/getAuth).
    // A raw `complete()` bypass would leave this spy uncalled and fail the test.
    expect(completeMock).toHaveBeenCalledTimes(1);
    expect(completeMock.mock.calls[0][0]).toBe(model);
    expect(result?.compaction?.summary).toBe("This is the summary");
    expect(result?.compaction?.tokensBefore).toBe(1234);
  });

  it("returns no compaction when the model response has no text block (empty summary fallback)", async () => {
    completeMock.mockResolvedValue({
      role: "assistant",
      content: [{ type: "thinking", thinking: "thinking only, no text" }],
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });

    const result = await handler!(makeEvent(), ctx);

    expect(result?.compaction).toBeUndefined();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.stringContaining("Summary was empty"),
      "warning",
    );
  });
});
