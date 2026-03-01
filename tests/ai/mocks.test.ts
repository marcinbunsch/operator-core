import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as LanguageModel from "../../src/ai/index.js";

/**
 * Mock LanguageModel that returns a predefined response.
 */
export const makeMockLanguageModel = (response: {
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}) => {
  return Layer.succeed(LanguageModel.LanguageModel.LanguageModel, {
    generateText: () =>
      Effect.succeed({
        text: response.text,
        content: [{ type: "text" as const, text: response.text }],
        finishReason: response.finishReason ?? "stop",
        usage: {
          inputTokens: response.inputTokens ?? 10,
          outputTokens: response.outputTokens ?? 20,
        },
        reasoning: [],
        reasoningText: "",
        toolCalls: [],
        toolResults: [],
      }),
    generateObject: () => Effect.die("not implemented"),
    streamText: () => Effect.die("not implemented"),
  } as unknown as LanguageModel.LanguageModel.Service);
};

/**
 * Mock LanguageModel that fails with an error.
 */
export const makeMockFailingLanguageModel = (errorMessage: string) => {
  return Layer.succeed(LanguageModel.LanguageModel.LanguageModel, {
    generateText: () => Effect.fail(new Error(errorMessage)),
    generateObject: () => Effect.die("not implemented"),
    streamText: () => Effect.die("not implemented"),
  } as unknown as LanguageModel.LanguageModel.Service);
};

describe("Mock LanguageModel", () => {
  it.effect("can create a mock language model layer", () =>
    Effect.sync(() => {
      const mockLayer = makeMockLanguageModel({ text: "Hello!" });
      expect(Layer.isLayer(mockLayer)).toBe(true);
    }),
  );

  it.effect("generates expected response", () =>
    Effect.gen(function* () {
      const lm = yield* LanguageModel.LanguageModel.LanguageModel;
      const response = yield* lm.generateText({
        prompt: { content: [] } as any,
      });

      expect(response.text).toBe("Test response");
      expect(response.usage.inputTokens).toBe(5);
      expect(response.usage.outputTokens).toBe(10);
    }).pipe(
      Effect.provide(
        makeMockLanguageModel({
          text: "Test response",
          inputTokens: 5,
          outputTokens: 10,
        }),
      ),
    ),
  );

  it.effect("failing model produces error", () =>
    Effect.gen(function* () {
      const lm = yield* LanguageModel.LanguageModel.LanguageModel;
      const result = yield* lm
        .generateText({
          prompt: { content: [] } as any,
        })
        .pipe(Effect.exit);

      expect(result._tag).toBe("Failure");
    }).pipe(Effect.provide(makeMockFailingLanguageModel("API error"))),
  );
});
