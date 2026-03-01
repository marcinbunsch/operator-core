// @operator/core - Framework foundation for the Operator AI agent ecosystem

export const VERSION = "0.0.1";

// Agent types and loop
export {
  AgentContext,
  type AgentContextValue,
  type AgentResponse,
  type ResponseTarget,
} from "./agent/types.js";

export { runAgenticLoop, type AgenticLoopConfig, type AgenticLoopResult } from "./agent/loop.js";

// Errors
export { JobNotFoundError, SpawnError } from "./errors.js";

// Services
export {
  JobQueueService,
  type Job,
  type JobStatus,
  type RunnerFn,
  type ReconnectFn,
} from "./services/JobQueueService.js";

export { SpawnService, type SpawnOptions } from "./services/SpawnService.js";

// AI - LLM abstraction and providers
export {
  createOpenAiLayer,
  createAnthropicLayer,
  type OpenAiConfig,
  type AnthropicConfig,
  LanguageModel,
  Prompt,
  Tool,
  Toolkit,
  AiError,
} from "./ai/index.js";
