import { Data } from "effect";

/**
 * Error for missing configuration.
 */
export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

/**
 * Error for Slack API operations.
 */
export class SlackError extends Data.TaggedError("SlackError")<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}
