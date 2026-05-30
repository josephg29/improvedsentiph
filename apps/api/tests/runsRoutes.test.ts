import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import type { RouteHandlerDependencies } from "../src/createApiServer/routeHelpers";
import {
  handleRecipesRoute,
  handleRunApprovalRoute,
  handleRunCancelRoute,
  handleRunItemRoute,
  handleRunsCollectionRoute,
} from "../src/createApiServer/runsRoutes";
import { RuntimeInputError } from "../src/terminalRuntime";

interface MockResponse {
  statusCode: number;
  body: string;
  json: () => unknown;
}

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
  const accessor: MockResponse = {
    get statusCode() {
      return state.statusCode;
    },
    get body() {
      return state.body;
    },
    json() {
      return state.body ? JSON.parse(state.body) : undefined;
    },
  };
  return { response: response as unknown as ServerResponse, result: accessor };
};

const makeRequest = (method: string, body?: string): IncomingMessage => {
  const request = (
    body !== undefined ? Readable.from([body]) : new Readable({ read() {} })
  ) as IncomingMessage;
  request.method = method;
  return request;
};

const deps = (pipelineRuntime: Record<string, unknown>): RouteHandlerDependencies =>
  ({ pipelineRuntime }) as unknown as RouteHandlerDependencies;

// Convenience that pairs a context with its inspectable response.
const run = async (
  handler: typeof handleRunsCollectionRoute,
  method: string,
  path: string,
  pipelineRuntime: Record<string, unknown>,
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
    deps(pipelineRuntime),
  );
  return { handled, result };
};

describe("handleRunsCollectionRoute", () => {
  it("ignores non-/api/runs paths", async () => {
    const { handled } = await run(handleRunsCollectionRoute, "GET", "/api/other", {});
    expect(handled).toBe(false);
  });

  it("lists runs on GET", async () => {
    const listRuns = vi.fn(() => [{ runId: "run-1", status: "passed" }]);
    const { handled, result } = await run(handleRunsCollectionRoute, "GET", "/api/runs", {
      listRuns,
    });
    expect(handled).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual([{ runId: "run-1", status: "passed" }]);
  });

  it("starts a run on a valid POST", async () => {
    const startRun = vi.fn(() => ({ runId: "run-9", status: "pending" }));
    const { result } = await run(
      handleRunsCollectionRoute,
      "POST",
      "/api/runs",
      { startRun },
      JSON.stringify({ task: "do it" }),
    );
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ runId: "run-9", status: "pending" });
    expect(startRun).toHaveBeenCalledWith("do it", "standard");
  });

  it("rejects an empty task with 400", async () => {
    const { result } = await run(
      handleRunsCollectionRoute,
      "POST",
      "/api/runs",
      { startRun: vi.fn() },
      JSON.stringify({ task: "   " }),
    );
    expect(result.statusCode).toBe(400);
  });

  it("rejects an unknown recipe with 400", async () => {
    const { result } = await run(
      handleRunsCollectionRoute,
      "POST",
      "/api/runs",
      { startRun: vi.fn() },
      JSON.stringify({ task: "x", recipeId: "nope" }),
    );
    expect(result.statusCode).toBe(400);
  });

  it("maps a RuntimeInputError from startRun to 400", async () => {
    const startRun = vi.fn(() => {
      throw new RuntimeInputError("bad");
    });
    const { result } = await run(
      handleRunsCollectionRoute,
      "POST",
      "/api/runs",
      { startRun },
      JSON.stringify({ task: "x" }),
    );
    expect(result.statusCode).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const { result } = await run(
      handleRunsCollectionRoute,
      "POST",
      "/api/runs",
      { startRun: vi.fn() },
      "not json",
    );
    expect(result.statusCode).toBe(400);
  });

  it("rejects an unsupported method with 405", async () => {
    const { result } = await run(handleRunsCollectionRoute, "PUT", "/api/runs", {});
    expect(result.statusCode).toBe(405);
  });
});

describe("handleRunItemRoute", () => {
  it("returns the run on GET when it exists", async () => {
    const getRun = vi.fn(() => ({ runId: "run-1", status: "passed" }));
    const { handled, result } = await run(handleRunItemRoute, "GET", "/api/runs/run-1", { getRun });
    expect(handled).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ runId: "run-1" });
  });

  it("returns 404 for an unknown run", async () => {
    const { result } = await run(handleRunItemRoute, "GET", "/api/runs/missing", {
      getRun: vi.fn(() => null),
    });
    expect(result.statusCode).toBe(404);
  });

  it("returns 405 for a non-GET method", async () => {
    const { result } = await run(handleRunItemRoute, "DELETE", "/api/runs/run-1", {
      getRun: vi.fn(),
    });
    expect(result.statusCode).toBe(405);
  });
});

describe("handleRunCancelRoute", () => {
  it("cancels an active run with 200", async () => {
    const cancelRun = vi.fn(() => true);
    const { handled, result } = await run(handleRunCancelRoute, "POST", "/api/runs/run-1/cancel", {
      cancelRun,
    });
    expect(handled).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ ok: true });
  });

  it("returns 404 when the run does not exist", async () => {
    const { result } = await run(handleRunCancelRoute, "POST", "/api/runs/missing/cancel", {
      cancelRun: vi.fn(() => false),
      getRun: vi.fn(() => null),
    });
    expect(result.statusCode).toBe(404);
  });

  it("returns 409 when the run exists but is not active", async () => {
    const { result } = await run(handleRunCancelRoute, "POST", "/api/runs/run-1/cancel", {
      cancelRun: vi.fn(() => false),
      getRun: vi.fn(() => ({ runId: "run-1", status: "passed" })),
    });
    expect(result.statusCode).toBe(409);
  });

  it("returns 405 for a non-POST method", async () => {
    const { result } = await run(handleRunCancelRoute, "GET", "/api/runs/run-1/cancel", {
      cancelRun: vi.fn(),
    });
    expect(result.statusCode).toBe(405);
  });
});

describe("handleRunApprovalRoute", () => {
  it("approves an awaiting run with 200", async () => {
    const approveRun = vi.fn(() => true);
    const { result } = await run(handleRunApprovalRoute, "POST", "/api/runs/run-1/approve", {
      approveRun,
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ ok: true });
    expect(approveRun).toHaveBeenCalledWith("run-1");
  });

  it("rejects an awaiting run with 200", async () => {
    const rejectRun = vi.fn(() => true);
    const { result } = await run(handleRunApprovalRoute, "POST", "/api/runs/run-1/reject", {
      rejectRun,
    });
    expect(result.statusCode).toBe(200);
    expect(rejectRun).toHaveBeenCalledWith("run-1");
  });

  it("returns 404 when the run does not exist", async () => {
    const { result } = await run(handleRunApprovalRoute, "POST", "/api/runs/missing/approve", {
      approveRun: vi.fn(() => false),
      getRun: vi.fn(() => null),
    });
    expect(result.statusCode).toBe(404);
  });

  it("returns 409 when the run is not awaiting approval", async () => {
    const { result } = await run(handleRunApprovalRoute, "POST", "/api/runs/run-1/approve", {
      approveRun: vi.fn(() => false),
      getRun: vi.fn(() => ({ runId: "run-1", status: "passed" })),
    });
    expect(result.statusCode).toBe(409);
  });

  it("returns 405 for a non-POST method", async () => {
    const { result } = await run(handleRunApprovalRoute, "GET", "/api/runs/run-1/approve", {
      approveRun: vi.fn(),
    });
    expect(result.statusCode).toBe(405);
  });
});

describe("handleRecipesRoute", () => {
  it("lists recipes on GET", async () => {
    const { handled, result } = await run(handleRecipesRoute, "GET", "/api/recipes", {});
    expect(handled).toBe(true);
    expect(result.statusCode).toBe(200);
    const recipes = result.json() as Array<{ id: string }>;
    expect(recipes.map((recipe) => recipe.id)).toEqual(["standard", "quick", "careful"]);
  });

  it("returns 405 for a non-GET method", async () => {
    const { result } = await run(handleRecipesRoute, "POST", "/api/recipes", {});
    expect(result.statusCode).toBe(405);
  });
});
