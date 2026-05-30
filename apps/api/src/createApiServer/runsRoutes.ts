import { pickRecipe } from "../pipeline/recipePicker";
import { getRecipe, listRecipes } from "../pipeline/recipes";
import { RuntimeInputError } from "../terminalRuntime";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const RUN_ITEM_PATH_PATTERN = /^\/api\/runs\/([^/]+)$/;
const RUN_CANCEL_PATH_PATTERN = /^\/api\/runs\/([^/]+)\/cancel$/;
const RUN_APPROVAL_PATH_PATTERN = /^\/api\/runs\/([^/]+)\/(approve|reject)$/;

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

  const requestedRecipeId =
    payload && typeof payload.recipeId === "string" ? payload.recipeId.trim() : "";
  // An explicit recipe is honored; otherwise (absent or "auto") the deterministic
  // picker chooses based on the task.
  const recipeId =
    requestedRecipeId.length > 0 && requestedRecipeId !== "auto"
      ? requestedRecipeId
      : pickRecipe(task);
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

export const handleRunApprovalRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { pipelineRuntime },
) => {
  const match = requestUrl.pathname.match(RUN_APPROVAL_PATH_PATTERN);
  if (!match) {
    return false;
  }

  if (request.method !== "POST") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const runId = decodeURIComponent(match[1] ?? "");
  const decided =
    match[2] === "approve" ? pipelineRuntime.approveRun(runId) : pipelineRuntime.rejectRun(runId);
  if (decided) {
    writeJson(response, 200, { ok: true }, corsOrigin);
    return true;
  }

  if (!pipelineRuntime.getRun(runId)) {
    writeJson(response, 404, { error: "Run not found." }, corsOrigin);
    return true;
  }

  writeJson(response, 409, { error: "Run is not awaiting approval." }, corsOrigin);
  return true;
};

export const handleRecipesRoute: ApiRouteHandler = async ({
  request,
  response,
  requestUrl,
  corsOrigin,
}) => {
  if (requestUrl.pathname !== "/api/recipes") {
    return false;
  }

  if (request.method !== "GET") {
    writeMethodNotAllowed(response, corsOrigin);
    return true;
  }

  const recipes = listRecipes().map((recipe) => ({
    id: recipe.id,
    title: recipe.title,
    stages: recipe.stages.map((stage) => stage.role),
  }));
  writeJson(response, 200, recipes, corsOrigin);
  return true;
};
