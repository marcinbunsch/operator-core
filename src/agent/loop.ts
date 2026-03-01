/**
 * Agentic Loop
 *
 * The core execution loop that drives the agent. It repeatedly calls the LLM,
 * executes any requested tools, and continues until the LLM stops calling tools
 * or the maximum iteration limit is reached.
 *
 * This loop is interface-agnostic - it doesn't know about Slack, Matrix, or any
 * specific messaging platform. It communicates through the AgentContext abstraction.
 */
import { Effect, type Layer } from "effect";
import * as Lm from "@effect/ai/LanguageModel";
import * as Prompt from "@effect/ai/Prompt";
import * as AiError from "@effect/ai/AiError";
import type * as Toolkit from "@effect/ai/Toolkit";

/** Default maximum iterations before stopping the loop */
const DEFAULT_MAX_ITERATIONS = 10;

/**
 * Configuration for the agentic loop
 */
export interface AgenticLoopConfig {
  /** The language model service to use */
  readonly languageModel: Lm.Service;

  /** Initial prompt containing conversation history and system prompt */
  readonly prompt: Prompt.Prompt;

  /** Optional toolkit with tool definitions (if undefined, no tools available) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly toolkit?: Toolkit.Any;

  /**
   * Optional layer providing tool handler implementations.
   * Use Layer.mergeAll to combine multiple handler layers.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly toolHandlerLayer?: Layer.Layer<any, any, any>;

  /** Maximum iterations before stopping (default: 10) */
  readonly maxIterations?: number;

  /** Called on each iteration with the iteration number */
  readonly onIteration?: (iteration: number) => Effect.Effect<void>;

  /** Called when an error occurs, receives the error and can return a recovery message */
  readonly onError?: (error: unknown) => Effect.Effect<string | null>;
}

/**
 * Result of the agentic loop
 */
export interface AgenticLoopResult {
  /** The final text response from the LLM, or null if an error occurred */
  readonly text: string | null;

  /** Number of iterations performed */
  readonly iterations: number;

  /** Whether the loop completed normally or hit the iteration limit */
  readonly finishReason: "complete" | "max_iterations" | "error";

  /** Token usage statistics */
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

/**
 * Run the agentic loop.
 *
 * The loop will:
 * 1. Send the prompt to the LLM
 * 2. If the LLM calls tools, execute them and add results to the prompt
 * 3. Repeat until the LLM returns a final response or max iterations is reached
 *
 * @example
 * ```typescript
 * const result = yield* runAgenticLoop({
 *   languageModel,
 *   prompt: Prompt.system("You are a helpful assistant").pipe(
 *     Prompt.user("What's the weather?")
 *   ),
 *   toolkit: WeatherToolkit,
 *   toolHandlerLayer: WeatherToolHandlers,
 * })
 *
 * if (result.text) {
 *   console.log(result.text)
 * }
 * ```
 */
export const runAgenticLoop = (
  config: AgenticLoopConfig,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Effect.Effect<AgenticLoopResult, never, any> => {
  const {
    languageModel,
    toolkit,
    toolHandlerLayer,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    onIteration,
    onError,
  } = config;

  let prompt = config.prompt;

  return Effect.gen(function* () {
    let iterations = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let finalResponse: Lm.GenerateTextResponse<any> | null = null;
    let finishReason: AgenticLoopResult["finishReason"] = "complete";
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    while (iterations < maxIterations) {
      iterations++;

      if (onIteration) {
        yield* onIteration(iterations);
      }

      // Build the generate effect with optional toolkit
      // Cast toolkit to any to satisfy complex generic constraints
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const generateEffect: Effect.Effect<
        Lm.GenerateTextResponse<any>,
        AiError.AiError,
        any
      > = toolkit
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          languageModel.generateText({ prompt, toolkit: toolkit as any })
        : languageModel.generateText({ prompt });

      // Apply handler layers if provided
      const effectWithHandlers = toolHandlerLayer
        ? generateEffect.pipe(Effect.provide(toolHandlerLayer))
        : generateEffect;

      // Execute and handle errors
      const response = yield* effectWithHandlers.pipe(
        Effect.catchAll((err) => {
          return handleError(err, onError);
        }),
      );

      // Null response means error was handled
      if (!response) {
        finishReason = "error";
        break;
      }

      finalResponse = response;

      // Track token usage (default to 0 if not provided)
      totalInputTokens += response.usage.inputTokens ?? 0;
      totalOutputTokens += response.usage.outputTokens ?? 0;

      // Check if we're done
      if (response.finishReason !== "tool-calls") {
        break;
      }

      // LLM called tools - merge response into prompt and continue
      const responseParts = response.content;
      const responsePrompt = Prompt.fromResponseParts(responseParts);
      prompt = Prompt.merge(prompt, responsePrompt);
    }

    // Check if we hit the iteration limit
    if (iterations >= maxIterations && finishReason === "complete") {
      finishReason = "max_iterations";
    }

    return {
      text: finalResponse?.text?.trim() || null,
      iterations,
      finishReason,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
    };
  });
};

/**
 * Handle LLM errors with optional custom handler
 */
const handleError = (
  err: unknown,
  onError?: (error: unknown) => Effect.Effect<string | null>,
): Effect.Effect<null, never, never> => {
  return Effect.gen(function* () {
    const errorMessage = AiError.isAiError(err)
      ? String(err)
      : err instanceof Error
        ? err.message
        : String(err);

    yield* Effect.logError(`Agentic loop error: ${errorMessage}`);

    // Call custom error handler if provided
    if (onError) {
      yield* onError(err);
    }

    return null;
  });
};
