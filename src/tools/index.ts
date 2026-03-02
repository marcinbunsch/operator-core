/**
 * Sandboxed Tools Module
 *
 * Provides secure, sandboxed tools for file operations, shell commands, and HTTP requests.
 * All tools are constrained to operate within a configured workspace directory.
 */

import { Layer } from "effect";
import * as Toolkit from "@effect/ai/Toolkit";

// Sandbox service
export {
  SandboxService,
  SandboxViolationError,
  DomainNotAllowedError,
  makeSandboxLayer,
  type SandboxConfig,
} from "./SandboxService.js";

// Filesystem tools
export {
  FileRead,
  FileWrite,
  FileEdit,
  FileAppend,
  FilesystemToolkit,
  FilesystemToolHandlers,
  FileOperationError,
} from "./filesystem.js";

// Shell tool
export { Shell, ShellToolkit, ShellToolHandlers, ShellError } from "./shell.js";

// HTTP tool
export { HttpRequest, HttpToolkit, HttpToolHandlers, HttpRequestError } from "./http.js";

// Combined toolkit with all sandboxed tools
import { FileRead, FileWrite, FileEdit, FileAppend, FilesystemToolHandlers } from "./filesystem.js";
import { Shell, ShellToolHandlers } from "./shell.js";
import { HttpRequest, HttpToolHandlers } from "./http.js";

/**
 * Combined toolkit containing all sandboxed tools:
 * - file_read, file_write, file_edit, file_append
 * - shell
 * - http_request
 */
export const SandboxedToolkit = Toolkit.make(
  FileRead,
  FileWrite,
  FileEdit,
  FileAppend,
  Shell,
  HttpRequest,
);

/**
 * Combined handler layer for all sandboxed tools.
 * Requires SandboxService to be provided.
 */
export const SandboxedToolHandlers = Layer.mergeAll(
  FilesystemToolHandlers,
  ShellToolHandlers,
  HttpToolHandlers,
);
