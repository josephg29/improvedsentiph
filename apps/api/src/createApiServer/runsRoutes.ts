import { DEFAULT_RECIPE_ID, getRecipe } from "../pipeline/recipes";
import { RuntimeInputError } from "../terminalRuntime";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const RUN_ITEM_PATH_PATTERN = /^\/api\/runs\/([^/]+)$/;
const RUN_CANCEL_PATH_PATTERN = /^\/api\/runs\/([^/]+)\/cancel$/;

export const handleRunsCollectionRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { pipelineRuntime },
) => {
  if (requestUrl.pathname !== "/api/runs") {
    return false;
  }

  if (request.method === "GET") {
    writeJson(response, 200, pipelineRuntime.listRuns(), corsOrigin);
    return true;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
  if (!bodyReadResult.ok) {
    return true;
  }

  const payload = bodyReadResult.payload as Record<string, unknown> | null;
  const task = payload && typeof payload.task === "string" ? payload.task.trim() : "";
  if (!task) {
    writeJson(response, 400, { error: "A non-empty task is required." }, corsOrigin);
    return true;
  }

  const recipeId =
    payload && typeof payload.recipeId === "string" && payload.recipeId.trim().length > 0
      ? payload.recipeId.trim()
      : DEFAULT_RECIPE_ID;
  if (!getRecipe(recipeId)) {
    writeJson(response, 400, { error: `Unknown recipe "${recipeId}".` }, corsOrigin);
    return true;
  }

  try {
    const run = pipelineRuntime.startRun(task, recipeId);
    writeJson(response, 201, { runId: run.runId, status: run.status }, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 400, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};

export const handleRunCancelRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { pipelineRuntime },
) => {
  const match = requestUrl.pathname.match(RUN_CANCEL_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const runId = decodeURIComponent(match[1] ?? "");
  if (pipelineRuntime.cancelRun(runId)) {
    writeJson(response, 200, { ok: true }, corsOrigin);
    return true;
  }

  if (!pipelineRuntime.getRun(runId)) {
    writeJson(response, 404, { error: "Run not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 409, { error: "Run is not active." }, corsOrigin);
  return true;
};

export const handleRunItemRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { pipelineRuntime },
) => {
  const match = requestUrl.pathname.match(RUN_ITEM_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const runId = decodeURIComponent(match[1] ?? "");
  const run = pipelineRuntime.getRun(runId);
  if (!run) {
    writeJson(response, 404, { error: "Run not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 200, run, corsOrigin);
  return true;
};
