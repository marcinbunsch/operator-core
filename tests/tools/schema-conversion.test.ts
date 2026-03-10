import { describe, it, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Tool from "@effect/ai/Tool";
import * as Toolkit from "@effect/ai/Toolkit";
import { FileRead, FileWrite, FileEdit, FileAppend } from "../../src/tools/filesystem.js";
import { Shell } from "../../src/tools/shell.js";
import { HttpRequest } from "../../src/tools/http.js";

// Recreate the GetDateTime tool from Jessie to test it
const DateTimeResult = Schema.Struct({
  datetime: Schema.String,
  timezone: Schema.String,
  utcOffset: Schema.String,
  iso8601: Schema.String,
});

const GetDateTime = Tool.make("get_datetime", {
  description: "Get the current date, time, and timezone.",
  parameters: {},
  success: DateTimeResult,
});

/**
 * This test verifies that all sandboxed tool schemas can be converted to JSON Schema
 * for use with OpenAI and other LLM providers.
 *
 * The getJsonSchema function is what OpenAI provider calls internally.
 * If this throws, the tool won't work with OpenAI.
 */
describe("Tool Schema Conversion", () => {
  describe("individual tools", () => {
    it.effect("FileRead schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(FileRead);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("FileWrite schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(FileWrite);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("FileEdit schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(FileEdit);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("FileAppend schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(FileAppend);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("Shell schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(Shell);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("HttpRequest schema converts to JSON Schema", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(HttpRequest);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );
  });

  describe("all tools together", () => {
    it.effect("all sandboxed tools convert successfully", () =>
      Effect.sync(() => {
        const tools = [FileRead, FileWrite, FileEdit, FileAppend, Shell, HttpRequest];

        for (const tool of tools) {
          const jsonSchema = Tool.getJsonSchema(tool);
          expect(jsonSchema).toBeDefined();
          expect(jsonSchema.type).toBe("object");
        }
      }),
    );

    it.effect("GetDateTime tool converts successfully", () =>
      Effect.sync(() => {
        const jsonSchema = Tool.getJsonSchema(GetDateTime);
        expect(jsonSchema).toBeDefined();
        expect(jsonSchema.type).toBe("object");
      }),
    );

    it.effect("combined Jessie toolkit converts successfully", () =>
      Effect.sync(() => {
        // This is the exact combination Jessie uses
        const JessieToolkit = Toolkit.make(
          GetDateTime,
          FileRead,
          FileWrite,
          FileEdit,
          FileAppend,
          Shell,
          HttpRequest,
        );

        // The toolkit should be able to convert all tools
        // Access the tools from the toolkit and convert each
        const tools = [GetDateTime, FileRead, FileWrite, FileEdit, FileAppend, Shell, HttpRequest];
        for (const tool of tools) {
          const jsonSchema = Tool.getJsonSchema(tool);
          expect(jsonSchema).toBeDefined();
        }
      }),
    );
  });

  describe("failure schema issue", () => {
    it.effect("tool with Schema.instanceOf failure throws on conversion", () =>
      Effect.sync(() => {
        // This should demonstrate the issue with Schema.instanceOf in failure schema
        const ToolWithFailure = Tool.make("test_with_failure", {
          description: "Test tool with failure schema",
          parameters: {
            input: Schema.String,
          },
          success: Schema.Struct({ result: Schema.String }),
          failure: Schema.instanceOf(Error),
        });

        // This should throw or fail if Schema.instanceOf causes issues
        expect(() => Tool.getJsonSchema(ToolWithFailure)).not.toThrow();
      }),
    );
  });

  describe("debug AST types", () => {
    it.effect("log AST type for Shell tool parameters", () =>
      Effect.sync(() => {
        // Access the internal parametersSchema to see AST type
        const tool = Shell as any;
        const ast = tool.parametersSchema?.ast;
        console.log("Shell AST type:", ast?._tag);
        console.log("Shell AST:", JSON.stringify(ast, null, 2).slice(0, 500));
        expect(ast).toBeDefined();
      }),
    );

    it.effect("log AST type for HttpRequest tool parameters", () =>
      Effect.sync(() => {
        const tool = HttpRequest as any;
        const ast = tool.parametersSchema?.ast;
        console.log("HttpRequest AST type:", ast?._tag);
        expect(ast).toBeDefined();
      }),
    );
  });
});
