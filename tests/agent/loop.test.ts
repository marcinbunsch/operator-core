import { describe, it, expect } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { runAgenticLoop } from "../../src/agent/loop.js";
import * as LanguageModel from "@effect/ai/LanguageModel";
import * as Prompt from "@effect/ai/Prompt";
import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";

/**
 * Create a mock LanguageModel that returns a simple text response.
 */
const makeMockLM = (response: {
  text: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}) => {
  const service: LanguageModel.Service = {
    generateText: () =>
      Effect.succeed({
        text: response.text,
        content: [{ type: "text" as const, text: response.text }],
        finishReason: response.finishReason ?? "stop",
        usage: {
          inputTokens: response.inputTokens ?? 10,
          outputTokens: response.outputTokens ?? 20,
        },
      }),
  } as LanguageModel.Service;

  return Layer.succeed(LanguageModel.LanguageModel, service);
};

/**
 * Create a mock LanguageModel that fails.
 */
const makeFailingLM = (error: Error) => {
  const service: LanguageModel.Service = {
    generateText: () => Effect.fail(error),
  } as LanguageModel.Service;

  return Layer.succeed(LanguageModel.LanguageModel, service);
};

/**
 * Create a mock LanguageModel that calls tools, then returns text.
 */
const makeToolCallingLM = (
  toolCalls: Array<{ name: string; args: any }>,
  finalResponse: string
) => {
  let callCount = 0;

  const service: LanguageModel.Service = {
    generateText: () => {
      callCount++;
      if (callCount === 1) {
        // First call: return tool calls
        return Effect.succeed({
          text: null,
          content: toolCalls.map((tc) => ({
            type: "tool-call" as const,
            id: `call-${tc.name}`,
            name: tc.name,
            args: tc.args,
          })),
          finishReason: "tool-calls",
          usage: { inputTokens: 10, outputTokens: 5 },
        });
      } else {
        // Subsequent calls: return final response
        return Effect.succeed({
          text: finalResponse,
          content: [{ type: "text" as const, text: finalResponse }],
          finishReason: "stop",
          usage: { inputTokens: 15, outputTokens: 25 },
        });
      }
    },
  } as LanguageModel.Service;

  return Layer.succeed(LanguageModel.LanguageModel, service);
};

describe("runAgenticLoop", () => {
  describe("basic execution", () => {
    it.effect("returns text response from LLM", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Hello" },
        ]);

        const result = yield* runAgenticLoop({
          languageModel: lm,
          prompt,
        });

        expect(result.text).toBe("Hello, world!");
        expect(result.finishReason).toBe("complete");
        expect(result.iterations).toBe(1);
      }).pipe(Effect.provide(makeMockLM({ text: "Hello, world!" })))
    );

    it.effect("tracks token usage", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);

        const result = yield* runAgenticLoop({
          languageModel: lm,
          prompt,
        });

        expect(result.usage.inputTokens).toBe(100);
        expect(result.usage.outputTokens).toBe(50);
      }).pipe(
        Effect.provide(
          makeMockLM({ text: "Response", inputTokens: 100, outputTokens: 50 })
        )
      )
    );

    it.effect("calls onIteration callback", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);
        const iterations: number[] = [];

        yield* runAgenticLoop({
          languageModel: lm,
          prompt,
          onIteration: (n) => Effect.sync(() => iterations.push(n)),
        });

        expect(iterations).toEqual([1]);
      }).pipe(Effect.provide(makeMockLM({ text: "Response" })))
    );
  });

  describe("iteration limits", () => {
    it.effect("respects maxIterations setting", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);
        const iterations: number[] = [];

        // Use a LM that always calls tools (would loop forever)
        const infiniteToolLM: LanguageModel.Service = {
          generateText: () =>
            Effect.succeed({
              text: null,
              content: [
                {
                  type: "tool-call" as const,
                  id: "call-1",
                  name: "test_tool",
                  args: {},
                },
              ],
              finishReason: "tool-calls",
              usage: { inputTokens: 10, outputTokens: 10 },
            }),
        } as LanguageModel.Service;

        const result = yield* runAgenticLoop({
          languageModel: infiniteToolLM,
          prompt,
          maxIterations: 3,
          onIteration: (n) => Effect.sync(() => iterations.push(n)),
        });

        expect(result.iterations).toBe(3);
        expect(result.finishReason).toBe("max_iterations");
        expect(iterations).toEqual([1, 2, 3]);
      }).pipe(Effect.provide(makeMockLM({ text: "Response" })))
    );

    it.effect("uses default max iterations of 10", () =>
      Effect.gen(function* () {
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);

        // Create a LM that always returns tool calls
        const infiniteToolLM: LanguageModel.Service = {
          generateText: () =>
            Effect.succeed({
              text: null,
              content: [
                {
                  type: "tool-call" as const,
                  id: "call-1",
                  name: "test_tool",
                  args: {},
                },
              ],
              finishReason: "tool-calls",
              usage: { inputTokens: 10, outputTokens: 10 },
            }),
        } as LanguageModel.Service;

        const result = yield* runAgenticLoop({
          languageModel: infiniteToolLM,
          prompt,
        });

        expect(result.iterations).toBe(10);
        expect(result.finishReason).toBe("max_iterations");
      })
    );
  });

  describe("error handling", () => {
    it.effect("calls onError callback when LLM fails", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);
        let errorCaught: unknown = null;

        const result = yield* runAgenticLoop({
          languageModel: lm,
          prompt,
          onError: (err) =>
            Effect.sync(() => {
              errorCaught = err;
              return null;
            }),
        });

        expect(result.finishReason).toBe("error");
        expect(result.text).toBe(null);
        expect(errorCaught).toBeInstanceOf(Error);
      }).pipe(Effect.provide(makeFailingLM(new Error("API Error"))))
    );

    it.effect("returns null text on error", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "user" as const, content: "Test" },
        ]);

        const result = yield* runAgenticLoop({
          languageModel: lm,
          prompt,
        });

        expect(result.text).toBe(null);
        expect(result.finishReason).toBe("error");
      }).pipe(Effect.provide(makeFailingLM(new Error("API Error"))))
    );
  });

  describe("with system prompt", () => {
    it.effect("handles prompts with system messages", () =>
      Effect.gen(function* () {
        const lm = yield* LanguageModel.LanguageModel;
        const prompt = Prompt.make([
          { role: "system" as const, content: "You are helpful." },
          { role: "user" as const, content: "Hello" },
        ]);

        const result = yield* runAgenticLoop({
          languageModel: lm,
          prompt,
        });

        expect(result.text).toBe("I am a helpful assistant.");
        expect(result.finishReason).toBe("complete");
      }).pipe(Effect.provide(makeMockLM({ text: "I am a helpful assistant." })))
    );
  });
});
