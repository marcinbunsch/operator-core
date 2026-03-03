import { describe, expect, test } from "bun:test";
import { LogLevel } from "@slack/bolt";
import { createSocketModeReceiverWithReconnect } from "../src/slackSocketMode.js";

describe("createSocketModeReceiverWithReconnect", () => {
  test("schedules reconnect on logger error message", () => {
    const calls: Array<{ reason: string }> = [];
    const { logger } = createSocketModeReceiverWithReconnect({
      appToken: "x",
      logLevel: LogLevel.ERROR,
      scheduleReconnect: (reason) => {
        calls.push({ reason });
      },
      isTransientSocketError: () => false,
    });

    logger.error("Failed to retrieve a new WSS URL for reconnection (error: internal_error)");

    expect(calls).toHaveLength(1);
    expect(calls[0].reason.includes("Failed to retrieve a new WSS URL")).toBe(true);
  });

  test("schedules reconnect on processEventErrorHandler transient error", async () => {
    const calls: Array<{ reason: string }> = [];
    const { processEventErrorHandler } = createSocketModeReceiverWithReconnect({
      appToken: "x",
      logLevel: LogLevel.ERROR,
      scheduleReconnect: (reason) => {
        calls.push({ reason });
      },
      isTransientSocketError: () => true,
    });

    const result = await processEventErrorHandler({
      error: new Error("client is not ready"),
      logger: { error: () => {} },
    });

    expect(result).toBe(true);
    expect(calls).toHaveLength(1);
  });

  test("schedules reconnect on socket client error event", () => {
    const calls: Array<{ reason: string }> = [];
    const { receiver } = createSocketModeReceiverWithReconnect({
      appToken: "x",
      logLevel: LogLevel.ERROR,
      scheduleReconnect: (reason) => {
        calls.push({ reason });
      },
      isTransientSocketError: () => false,
    });

    (receiver.client as any).emit("error", new Error("boom"));

    expect(calls).toHaveLength(1);
    expect(calls[0].reason.includes("boom")).toBe(true);
  });
});
