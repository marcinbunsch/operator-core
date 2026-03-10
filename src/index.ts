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

export {
  SchedulerService,
  type Schedule,
  type ScheduleType,
  type ScheduleStatus,
} from "./services/SchedulerService.js";

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

// Sandboxed Tools
export {
  // Sandbox service
  SandboxService,
  SandboxViolationError,
  DomainNotAllowedError,
  makeSandboxLayer,
  type SandboxConfig,
  // Filesystem tools
  FileRead,
  FileWrite,
  FileEdit,
  FileAppend,
  FilesystemToolkit,
  FilesystemToolHandlers,
  FileOperationError,
  // Shell tool
  Shell,
  ShellToolkit,
  ShellToolHandlers,
  ShellError,
  // HTTP tool
  HttpRequest,
  HttpToolkit,
  HttpToolHandlers,
  HttpRequestError,
  // Scheduler tools
  ScheduleTask,
  ListSchedules,
  DeleteSchedule,
  PauseSchedule,
  ResumeSchedule,
  SchedulerToolkit,
  SchedulerToolHandlers,
  // Combined
  SandboxedToolkit,
  SandboxedToolHandlers,
} from "./tools/index.js";
