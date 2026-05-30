import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { RouteHandlerDependencies } from "../src/createApiServer/routeHelpers";
import {
  handleTerminalInputRoute,
  handleTerminalScrollbackRoute,
} from "../src/createApiServer/terminalRoutes";

const mockResponse = () => {
  const state = { statusCode: 0, body: "" };
  const response = {
    writeHead(status: number) {
      state.statusCode = status;
      return response;
    },
    end(chunk?: string) {
      if (chunk !== undefined) {
        state.body += chunk;
      }
    },
  };
  return {
    response: response as unknown as ServerResponse,
    result: {
      get statusCode() {
        return state.statusCode;
      },
      json() {
        return state.body ? JSON.parse(state.body) : undefined;
      },
    },
  };
};

const makeRequest = (method: string, body?: string): IncomingMessage => {
  const request = (
    body !== undefined ? Readable.from([body]) : new Readable({ read() {} })
  ) as IncomingMessage;
  request.method = method;
  return request;
};

const run = async (
  handler: typeof handleTerminalInputRoute,
  method: string,
  path: string,
  runtime: Record<string, unknown>,
  body?: string,
) => {
  const { response, result } = mockResponse();
  const handled = await handler(
    {
      request: makeRequest(method, body),
      response,
      requestUrl: new URL(`http://localhost${path}`),
      corsOrigin: null,
    },
    { runtime } as unknown as RouteHandlerDependencies,
  );
  return { handled, result };
};

describe("handleTerminalInputRoute", () => {
  it("ignores non-input paths", async () => {
    const { handled } = await run(handleTerminalInputRoute, "POST", "/api/terminals/t1", {});
    expect(handled).toBe(false);
  });

  it("writes input to a live terminal", async () => {
    const writeInput = vi.fn(() => true);
    const { result } = await run(
      handleTerminalInputRoute,
      "POST",
      "/api/terminals/t1/input",
      { writeInput },
      JSON.stringify({ data: "hello\r" }),
    );
    expect(result.statusCode).toBe(200);
    expect(writeInput).toHaveBeenCalledWith("t1", "hello\r");
  });

  it("returns 404 for an unknown terminal", async () => {
    const { result } = await run(
      handleTerminalInputRoute,
      "POST",
      "/api/terminals/missing/input",
      { writeInput: vi.fn(() => false) },
      JSON.stringify({ data: "x" }),
    );
    expect(result.statusCode).toBe(404);
  });

  it("rejects a body without a string data field", async () => {
    const { result } = await run(
      handleTerminalInputRoute,
      "POST",
      "/api/terminals/t1/input",
      { writeInput: vi.fn() },
      JSON.stringify({}),
    );
    expect(result.statusCode).toBe(400);
  });

  it("rejects a non-POST method", async () => {
    const { result } = await run(handleTerminalInputRoute, "GET", "/api/terminals/t1/input", {
      writeInput: vi.fn(),
    });
    expect(result.statusCode).toBe(405);
  });
});

describe("handleTerminalScrollbackRoute", () => {
  it("returns the scrollback for a live terminal", async () => {
    const getScrollback = vi.fn(() => "line one\nline two");
    const { result } = await run(
      handleTerminalScrollbackRoute,
      "GET",
      "/api/terminals/t1/scrollback",
      {
        getScrollback,
      },
    );
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ scrollback: "line one\nline two" });
    expect(getScrollback).toHaveBeenCalledWith("t1");
  });

  it("returns 404 when there is no such terminal", async () => {
    const { result } = await run(
      handleTerminalScrollbackRoute,
      "GET",
      "/api/terminals/x/scrollback",
      {
        getScrollback: vi.fn(() => null),
      },
    );
    expect(result.statusCode).toBe(404);
  });

  it("rejects a non-GET method", async () => {
    const { result } = await run(
      handleTerminalScrollbackRoute,
      "POST",
      "/api/terminals/t1/scrollback",
      {
        getScrollback: vi.fn(),
      },
    );
    expect(result.statusCode).toBe(405);
  });
});
