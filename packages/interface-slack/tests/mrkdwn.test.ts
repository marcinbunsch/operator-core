import { describe, it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { markdownToMrkdwn } from "../src/mrkdwn.js";

describe("markdownToMrkdwn", () => {
  it.effect("converts bold markdown to mrkdwn", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn("**bold text**");
      expect(result).toBe("*bold text*");
    }),
  );

  it.effect("converts italic markdown to mrkdwn", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn("*italic text*");
      expect(result).toBe("_italic text_");
    }),
  );

  it.effect("converts links to mrkdwn format", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn("[Click here](https://example.com)");
      expect(result).toBe("<https://example.com|Click here>");
    }),
  );

  it.effect("converts headers to bold", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn("# Header");
      expect(result).toBe("*Header*");
    }),
  );

  it.effect("handles mixed formatting", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn(
        "**Bold** and *italic* with [link](https://example.com)",
      );
      expect(result).toBe("*Bold* and _italic_ with <https://example.com|link>");
    }),
  );

  it.effect("leaves plain text unchanged", () =>
    Effect.sync(() => {
      const result = markdownToMrkdwn("Just plain text");
      expect(result).toBe("Just plain text");
    }),
  );
});
