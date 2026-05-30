import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_API_PORT = 8787;
const MAX_PORT_ATTEMPTS = 200;

const parsePort = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
};

const isPortInUseError = (error) =>
  Boolean(error) &&
  typeof error === "object" &&
  "code" in error &&
  (error.code === "EADDRINUSE" || error.code === "EACCES");

const canListenOnPort = (port) =>
  new Promise((resolve) => {
    const probeServer = createServer();

    const closeAndResolve = (result) => {
      probeServer.removeAllListeners();
      probeServer.close(() => {
        resolve(result);
      });
    };

    probeServer.once("error", (error) => {
      if (isPortInUseError(error)) {
        resolve(false);
        return;
      }

      resolve(false);
    });

    probeServer.once("listening", () => {
      closeAndResolve(true);
    });

    probeServer.listen(port, "127.0.0.1");
  });

const findOpenPort = async (startPort) => {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = startPort + offset;
    if (port > 65535) {
      break;
    }

    // eslint-disable-next-line no-await-in-loop
    const isAvailable = await canListenOnPort(port);
    if (isAvailable) {
      return port;
    }
  }

  throw new Error(`Unable to find an open port starting from ${startPort}`);
};

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// The API server binds 127.0.0.1 (matching this probe), so resolving its port
// here is reliable. Vite picks its own web port (it auto-increments when a port
// is busy, e.g. another Sentiph instance), so rather than guess it we read the
// real URL from Vite's output below and surface it clearly.
const apiPort = await findOpenPort(parsePort(process.env.SENTIPH_DEV_START_PORT, DEFAULT_API_PORT));
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const monorepoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// Resolve project state dir from global registry.
const resolveProjectStateDir = (workspaceCwd) => {
  if (process.env.SENTIPH_PROJECT_STATE_DIR) {
    return process.env.SENTIPH_PROJECT_STATE_DIR;
  }
  const projectConfigPath = join(workspaceCwd, ".sentiph", "project.json");
  if (existsSync(projectConfigPath)) {
    try {
      const projectConfig = JSON.parse(readFileSync(projectConfigPath, "utf-8"));
      if (
        typeof projectConfig.projectId === "string" &&
        projectConfig.projectId.trim().length > 0
      ) {
        return join(homedir(), ".sentiph", "projects", projectConfig.projectId);
      }
    } catch {
      // fall through
    }
  }
  const projectsFile = join(homedir(), ".sentiph", "projects.json");
  if (existsSync(projectsFile)) {
    try {
      const registry = JSON.parse(readFileSync(projectsFile, "utf-8"));
      const project = registry.projects?.find((p) => p.path === workspaceCwd);
      if (project) {
        if (typeof project.id === "string" && project.id.trim().length > 0) {
          return join(homedir(), ".sentiph", "projects", project.id);
        }
        if (typeof project.name === "string" && project.name.trim().length > 0) {
          return join(homedir(), ".sentiph", "projects", project.name);
        }
      }
    } catch {
      // fall through
    }
  }
  return `${workspaceCwd}/.sentiph`;
};

const workspaceCwd = process.env.SENTIPH_WORKSPACE_CWD ?? monorepoRoot;
const projectStateDir = resolveProjectStateDir(workspaceCwd);

console.log(`[sentiph-dev] api server: ${apiOrigin}`);
console.log("[sentiph-dev] starting web server, the open URL will be shown below...");

const child = spawn(
  pnpmCommand,
  ["-r", "--parallel", "--filter", "@sentiph/api", "--filter", "@sentiph/web", "dev"],
  {
    // stdin inherited for interactivity; stdout/stderr piped so we can detect
    // Vite's chosen URL while still forwarding all output to the console.
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      SENTIPH_API_PORT: String(apiPort),
      SENTIPH_API_ORIGIN: apiOrigin,
      SENTIPH_WORKSPACE_CWD: workspaceCwd,
      SENTIPH_PROJECT_STATE_DIR: projectStateDir,
    },
  },
);

const maybeOpenBrowser = (url) => {
  if (process.env.SENTIPH_NO_OPEN === "1" || process.env.CI === "1") {
    return;
  }

  const command =
    process.platform === "darwin"
      ? { file: "open", args: [url] }
      : process.platform === "win32"
        ? { file: "cmd", args: ["/c", "start", "", url] }
        : { file: "xdg-open", args: [url] };

  try {
    const opener = spawn(command.file, command.args, { stdio: "ignore", detached: true });
    opener.unref();
  } catch {
    // Best-effort; the printed URL is the fallback.
  }
};

let announced = false;
const announce = (webUrl) => {
  if (announced) {
    return;
  }
  announced = true;
  console.log("");
  console.log("  ──────────────────────────────────────────────");
  console.log(`  ▶ Open Sentiph:   ${webUrl}`);
  console.log(`    API server:     ${apiOrigin}  (no UI — don't open this one)`);
  console.log("  ──────────────────────────────────────────────");
  console.log("");
  const timer = setTimeout(() => maybeOpenBrowser(webUrl), 1500);
  timer.unref?.();
};

// Vite prints a line like:  ➜  Local:   http://localhost:5175/
const LOCAL_URL_PATTERN = /Local:\s*(https?:\/\/localhost:\d+)/i;

child.stdout?.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  const match = text.match(LOCAL_URL_PATTERN);
  if (match?.[1]) {
    announce(match[1].replace(/\/+$/, ""));
  }
});

child.stderr?.on("data", (chunk) => {
  process.stderr.write(chunk);
});

const forwardSignal = (signal) => {
  if (child.killed) {
    return;
  }

  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
