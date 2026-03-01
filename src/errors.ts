import { Data } from "effect";

export class JobNotFoundError extends Data.TaggedError("JobNotFoundError")<{
  readonly jobId: string;
}> {}

export class SpawnError extends Data.TaggedError("SpawnError")<{
  readonly command: string;
  readonly cause?: unknown;
}> {}
