import { Effect, Schema, Data } from "effect";
import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { SandboxService } from "./SandboxService.js";

/**
 * Error thrown when a file operation fails
 */
export class FileOperationError extends Data.TaggedError("FileOperationError")<{
  readonly message: string;
  readonly path: string;
  readonly operation: "read" | "write" | "edit" | "append";
}> {}

// Error schema for tool failures (simple struct that converts to JSON Schema)
const ToolError = Schema.Struct({
  error: Schema.String,
  path: Schema.String,
});

// Result schemas - include error field for error responses
const FileReadResult = Schema.Union(
  Schema.Struct({
    content: Schema.String,
    path: Schema.String,
  }),
  ToolError,
);

const FileWriteResult = Schema.Union(
  Schema.Struct({
    success: Schema.Literal(true),
    path: Schema.String,
    bytesWritten: Schema.Number,
  }),
  ToolError,
);

const FileEditResult = Schema.Union(
  Schema.Struct({
    success: Schema.Literal(true),
    path: Schema.String,
    replacements: Schema.Number,
  }),
  ToolError,
);

const FileAppendResult = Schema.Union(
  Schema.Struct({
    success: Schema.Literal(true),
    path: Schema.String,
    bytesAppended: Schema.Number,
  }),
  ToolError,
);

// Tool definitions
export const FileRead = Tool.make("file_read", {
  description: "Read the contents of a file in the workspace",
  parameters: {
    path: Schema.String.annotations({
      description: "Relative path to the file within the workspace",
    }),
  },
  success: FileReadResult,
});

export const FileWrite = Tool.make("file_write", {
  description: "Write contents to a file in the workspace (creates directories if needed)",
  parameters: {
    path: Schema.String.annotations({
      description: "Relative path to the file within the workspace",
    }),
    content: Schema.String.annotations({
      description: "Content to write to the file",
    }),
  },
  success: FileWriteResult,
});

export const FileEdit = Tool.make("file_edit", {
  description: "Find and replace text in a file",
  parameters: {
    path: Schema.String.annotations({
      description: "Relative path to the file within the workspace",
    }),
    old_text: Schema.String.annotations({
      description: "Text to find in the file",
    }),
    new_text: Schema.String.annotations({
      description: "Replacement text",
    }),
  },
  success: FileEditResult,
});

export const FileAppend = Tool.make("file_append", {
  description: "Append content to the end of a file (creates the file if it doesn't exist)",
  parameters: {
    path: Schema.String.annotations({
      description: "Relative path to the file within the workspace",
    }),
    content: Schema.String.annotations({
      description: "Content to append to the file",
    }),
  },
  success: FileAppendResult,
});

// Toolkit combining all filesystem tools
export const FilesystemToolkit = Toolkit.make(FileRead, FileWrite, FileEdit, FileAppend);

// Helper to format error for tool response
const formatError = (error: unknown, filePath: string) => ({
  error: error instanceof Error ? error.message : String(error),
  path: filePath,
});

// Handler implementations - catch errors and return them as success responses
export const FilesystemToolHandlers = FilesystemToolkit.toLayer(
  Effect.gen(function* () {
    const sandbox = yield* SandboxService;

    return {
      file_read: ({ path: filePath }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(`Tool call: file_read | path=${filePath}`);
          const resolvedPath = yield* sandbox.resolvePath(filePath);
          const content = yield* Effect.tryPromise({
            try: () => fs.readFile(resolvedPath, "utf-8"),
            catch: (e) => e,
          });
          const result = { content, path: filePath };
          yield* Effect.logInfo(
            `Tool result: file_read | path=${filePath} contentLength=${content.length}`,
          );
          return result;
        }).pipe(
          Effect.catchAll((e) => {
            const err = formatError(e, filePath);
            return Effect.logInfo(
              `Tool result: file_read | path=${filePath} error=${err.error}`,
            ).pipe(Effect.map(() => err));
          }),
        ),

      file_write: ({ path: filePath, content }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Tool call: file_write | path=${filePath} contentLength=${content.length}`,
          );
          const resolvedPath = yield* sandbox.resolvePath(filePath);
          const dir = path.dirname(resolvedPath);
          yield* Effect.tryPromise({
            try: () => fs.mkdir(dir, { recursive: true }),
            catch: (e) => e,
          });
          yield* Effect.tryPromise({
            try: () => fs.writeFile(resolvedPath, content, "utf-8"),
            catch: (e) => e,
          });
          const bytesWritten = Buffer.byteLength(content, "utf-8");
          yield* Effect.logInfo(
            `Tool result: file_write | path=${filePath} bytesWritten=${bytesWritten}`,
          );
          return {
            success: true as const,
            path: filePath,
            bytesWritten,
          };
        }).pipe(
          Effect.catchAll((e) => {
            const err = formatError(e, filePath);
            return Effect.logInfo(
              `Tool result: file_write | path=${filePath} error=${err.error}`,
            ).pipe(Effect.map(() => err));
          }),
        ),

      file_edit: ({ path: filePath, old_text, new_text }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Tool call: file_edit | path=${filePath} oldTextLength=${old_text.length} newTextLength=${new_text.length}`,
          );
          const resolvedPath = yield* sandbox.resolvePath(filePath);
          const content = yield* Effect.tryPromise({
            try: () => fs.readFile(resolvedPath, "utf-8"),
            catch: (e) => e,
          });

          const regex = new RegExp(escapeRegex(old_text), "g");
          const matches = content.match(regex);
          const replacements = matches?.length ?? 0;

          if (replacements === 0) {
            const err = {
              error: `Text not found in file: "${old_text.slice(0, 50)}${old_text.length > 50 ? "..." : ""}"`,
              path: filePath,
            };
            yield* Effect.logInfo(`Tool result: file_edit | path=${filePath} error=${err.error}`);
            return err;
          }

          const newContent = content.replace(regex, new_text);
          yield* Effect.tryPromise({
            try: () => fs.writeFile(resolvedPath, newContent, "utf-8"),
            catch: (e) => e,
          });

          yield* Effect.logInfo(
            `Tool result: file_edit | path=${filePath} replacements=${replacements}`,
          );
          return { success: true as const, path: filePath, replacements };
        }).pipe(
          Effect.catchAll((e) => {
            const err = formatError(e, filePath);
            return Effect.logInfo(
              `Tool result: file_edit | path=${filePath} error=${err.error}`,
            ).pipe(Effect.map(() => err));
          }),
        ),

      file_append: ({ path: filePath, content }) =>
        Effect.gen(function* () {
          yield* Effect.logInfo(
            `Tool call: file_append | path=${filePath} contentLength=${content.length}`,
          );
          const resolvedPath = yield* sandbox.resolvePath(filePath);
          const dir = path.dirname(resolvedPath);
          yield* Effect.tryPromise({
            try: () => fs.mkdir(dir, { recursive: true }),
            catch: (e) => e,
          });
          yield* Effect.tryPromise({
            try: () => fs.appendFile(resolvedPath, content, "utf-8"),
            catch: (e) => e,
          });
          const bytesAppended = Buffer.byteLength(content, "utf-8");
          yield* Effect.logInfo(
            `Tool result: file_append | path=${filePath} bytesAppended=${bytesAppended}`,
          );
          return {
            success: true as const,
            path: filePath,
            bytesAppended,
          };
        }).pipe(
          Effect.catchAll((e) => {
            const err = formatError(e, filePath);
            return Effect.logInfo(
              `Tool result: file_append | path=${filePath} error=${err.error}`,
            ).pipe(Effect.map(() => err));
          }),
        ),
    };
  }),
);

// Helper to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
