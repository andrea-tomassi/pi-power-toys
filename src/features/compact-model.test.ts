import { describe, it, expect } from "vitest";
import { parseModelKey } from "./compact-model.ts";

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
