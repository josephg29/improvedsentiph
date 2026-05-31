import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApiServer } from "./createApiServer";
import { deriveProjectIdFromWorkspace, GLOBAL_SENTIPH_DIR } from "./projectPersistence";
import { acquireWorkspaceLock } from "./workspaceLock";

const parsePort = (value: string | undefined, fallback: number) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }
  return parsed;
};

const host = process.env.HOST ?? "127.0.0.1";
const port = parsePort(process.env.SENTIPH_API_PORT ?? process.env.PORT, 8787);
const allowRemoteAccess = process.env.SENTIPH_ALLOW_REMOTE_ACCESS === "1";
const bearerToken = process.env.SENTIPH_BEARER_TOKEN?.trim() || undefined;
const workspaceCwd = process.env.SENTIPH_WORKSPACE_CWD ?? process.cwd();
const projectStateDir = process.env.SENTIPH_PROJECT_STATE_DIR;
const webDistDir = process.env.SENTIPH_WEB_DIST_DIR;

// Validate startup environment
const validateStartupEnv = () => {
  const rawPort = process.env.SENTIPH_API_PORT ?? process.env.PORT;
  if (rawPort !== undefined) {
    const parsed = Number.parseInt(rawPort, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 65535) {
      console.error(`Invalid port "${rawPort}": must be an integer between 1 and 65535.`);
      process.exit(1);
    }
  }

  if (process.env.SENTIPH_WORKSPACE_CWD && !existsSync(process.env.SENTIPH_WORKSPACE_CWD)) {
    console.error(
      `SENTIPH_WORKSPACE_CWD directory does not exist: ${process.env.SENTIPH_WORKSPACE_CWD}`,
    );
    process.exit(1);
  }

  if (process.env.SENTIPH_WEB_DIST_DIR && !existsSync(process.env.SENTIPH_WEB_DIST_DIR)) {
    console.warn(
      `SENTIPH_WEB_DIST_DIR directory does not exist: ${process.env.SENTIPH_WEB_DIST_DIR} — web UI will be unavailable.`,
    );
  }
};

validateStartupEnv();

// Acquire workspace lock to prevent two API instances running against the same project.
const lockStateDir =
  projectStateDir ??
  join(GLOBAL_SENTIPH_DIR, "projects", deriveProjectIdFromWorkspace(workspaceCwd));
try {
  acquireWorkspaceLock(lockStateDir);
} catch (lockError) {
  console.error(lockError instanceof Error ? lockError.message : String(lockError));
  process.exit(1);
}

if (allowRemoteAccess && !bearerToken) {
  console.warn(
    "[sentiph] WARNING: SENTIPH_ALLOW_REMOTE_ACCESS=1 is set but SENTIPH_BEARER_TOKEN is not. " +
      "The API is exposed without authentication. Set SENTIPH_BEARER_TOKEN to a secret token.",
  );
}

const apiServer = createApiServer({
  workspaceCwd,
  projectStateDir,
  webDistDir,
  allowRemoteAccess,
  bearerToken,
});

const shutdown = async () => {
  await apiServer.stop();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

apiServer
  .start(port, host)
  .then(({ port: activePort }) => {
    console.log(`Sentiph API listening on http://${host}:${activePort}`);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
