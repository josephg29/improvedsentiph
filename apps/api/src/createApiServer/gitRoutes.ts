import { RuntimeInputError } from "../terminalRuntime";
import {
  parseAgentCommitMessage,
  parseAgentPullRequestCreateInput,
  parseAgentSyncBaseRef,
} from "./gitParsers";
import type { ApiRouteHandler } from "./routeHelpers";
import { readJsonBodyOrWriteError, writeJson, writeMethodNotAllowed } from "./routeHelpers";

const AGENT_GIT_ACTION_PATH_PATTERN =
  /^\/api\/agents\/([^/]+)\/git\/(status|commit|push|sync)$/;
const AGENT_GIT_PULL_REQUEST_PATH_PATTERN = /^\/api\/agents\/([^/]+)\/git\/pr$/;
const AGENT_GIT_PULL_REQUEST_MERGE_PATH_PATTERN = /^\/api\/agents\/([^/]+)\/git\/pr\/merge$/;

export const handleAgentGitRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const gitMatch = requestUrl.pathname.match(AGENT_GIT_ACTION_PATH_PATTERN);
  if (!gitMatch) {
    return false;
  }

  const agentId = decodeURIComponent(gitMatch[1] ?? "");
  const action = gitMatch[2];

  try {
    if (action === "status") {
      if (request.method !== "GET") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const payload = runtime.readAgentGitStatus(agentId);
      if (!payload) {
        writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (action === "commit") {
      if (request.method !== "POST") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const bodyReadResult = await readJsonBodyOrWriteError(request, response, corsOrigin);
      if (!bodyReadResult.ok) {
        return true;
      }

      const commitMessageResult = parseAgentCommitMessage(bodyReadResult.payload);
      if (commitMessageResult.error || !commitMessageResult.message) {
        writeJson(
          response,
          400,
          { error: commitMessageResult.error ?? "Commit message cannot be empty." },
          corsOrigin,
        );
        return true;
      }

      const payload = runtime.commitAgentWorktree(agentId, commitMessageResult.message);
      if (!payload) {
        writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    }

    if (action === "push") {
      if (request.method !== "POST") {
        writeMethodNotAllowed(response, corsOrigin);
        return true;
      }

      const payload = runtime.pushAgentWorktree(agentId);
      if (!payload) {
        writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
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

    const baseRefResult = parseAgentSyncBaseRef(bodyReadResult.payload);
    if (baseRefResult.error) {
      writeJson(response, 400, { error: baseRefResult.error }, corsOrigin);
      return true;
    }

    const payload = runtime.syncAgentWorktree(agentId, baseRefResult.baseRef ?? undefined);
    if (!payload) {
      writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 409, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};

export const handleAgentGitPullRequestRoute: ApiRouteHandler = async (
  { request, response, requestUrl, corsOrigin },
  { runtime },
) => {
  const mergeMatch = requestUrl.pathname.match(AGENT_GIT_PULL_REQUEST_MERGE_PATH_PATTERN);
  if (mergeMatch) {
    if (request.method !== "POST") {
      writeMethodNotAllowed(response, corsOrigin);
      return true;
    }

    const agentId = decodeURIComponent(mergeMatch[1] ?? "");
    try {
      const payload = runtime.mergeAgentPullRequest(agentId);
      if (!payload) {
        writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
      return true;
    } catch (error) {
      if (error instanceof RuntimeInputError) {
        writeJson(response, 409, { error: error.message }, corsOrigin);
        return true;
      }
      throw error;
    }
  }

  const prMatch = requestUrl.pathname.match(AGENT_GIT_PULL_REQUEST_PATH_PATTERN);
  if (!prMatch) {
    return false;
  }

  const agentId = decodeURIComponent(prMatch[1] ?? "");

  try {
    if (request.method === "GET") {
      const payload = runtime.readAgentPullRequest(agentId);
      if (!payload) {
        writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
        return true;
      }

      writeJson(response, 200, payload, corsOrigin);
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

    const pullRequestInput = parseAgentPullRequestCreateInput(bodyReadResult.payload);
    if (pullRequestInput.error || !pullRequestInput.title) {
      writeJson(
        response,
        400,
        { error: pullRequestInput.error ?? "Pull request title cannot be empty." },
        corsOrigin,
      );
      return true;
    }

    const payload = runtime.createAgentPullRequest(agentId, {
      title: pullRequestInput.title,
      ...(pullRequestInput.body.length > 0 ? { body: pullRequestInput.body } : {}),
      ...(pullRequestInput.baseRef !== null ? { baseRef: pullRequestInput.baseRef } : {}),
    });
    if (!payload) {
      writeJson(response, 404, { error: "Agent not found." }, corsOrigin);
      return true;
    }

    writeJson(response, 200, payload, corsOrigin);
    return true;
  } catch (error) {
    if (error instanceof RuntimeInputError) {
      writeJson(response, 409, { error: error.message }, corsOrigin);
      return true;
    }
    throw error;
  }
};
