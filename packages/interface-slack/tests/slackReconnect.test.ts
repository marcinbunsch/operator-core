import { describe, expect, test } from "bun:test";
import { createSocketModeReconnector } from "../src/slackReconnect.js";

describe("createSocketModeReconnector", () => {
  test("reconnects and resets failure count on success", async () => {
    const timers: Array<() => Promise<void> | void> = [];
    const client = {
      disconnect: async () => {},
      start: async () => {},
    };

    const reconnector = createSocketModeReconnector({
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return 0;
      },
      sleepFn: async () => {},
    });

    reconnector.scheduleReconnect("reason", client);
    expect(timers).toHaveLength(1);

    await timers[0]();

    const state = reconnector.getState();
    expect(state.consecutiveFailures).toBe(0);
    expect(state.reconnectInProgress).toBe(false);
  });

  test("debounces overlapping reconnect attempts", async () => {
    const timers: Array<() => Promise<void> | void> = [];
    let disconnectCalls = 0;
    let startCalls = 0;
    const client = {
      disconnect: async () => {
        disconnectCalls += 1;
      },
      start: async () => {
        startCalls += 1;
      },
    };

    const reconnector = createSocketModeReconnector({
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return 0;
      },
      sleepFn: async () => {},
    });

    reconnector.scheduleReconnect("first", client);
    reconnector.scheduleReconnect("second", client);

    expect(timers).toHaveLength(1);
    await timers[0]();
    expect(disconnectCalls).toBe(1);
    expect(startCalls).toBe(1);
  });

  test("reschedules after failed reconnect", async () => {
    const timers: Array<() => Promise<void> | void> = [];
    let startCalls = 0;
    const client = {
      disconnect: async () => {},
      start: async () => {
        startCalls += 1;
        if (startCalls === 1) {
          throw new Error("start failed");
        }
      },
    };

    const reconnector = createSocketModeReconnector({
      setTimeoutFn: (fn) => {
        timers.push(fn);
        return 0;
      },
      sleepFn: async () => {},
    });

    reconnector.scheduleReconnect("reason", client);
    expect(timers).toHaveLength(1);

    await timers[0]();
    expect(timers).toHaveLength(2);

    await timers[1]();
    expect(startCalls).toBe(2);
    expect(reconnector.getState().consecutiveFailures).toBe(0);
  });
});
