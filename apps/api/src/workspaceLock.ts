import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const isProcessRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export const acquireWorkspaceLock = (stateDir: string): (() => void) => {
  const lockDir = join(stateDir, "state");
  mkdirSync(lockDir, { recursive: true });
  const lockPath = join(lockDir, "api.lock");

  if (existsSync(lockPath)) {
    const content = readFileSync(lockPath, "utf8").trim();
    const existingPid = Number.parseInt(content, 10);
    if (Number.isFinite(existingPid) && existingPid > 0 && isProcessRunning(existingPid)) {
      throw new Error(
        `Another sentiph API process is already running for this project (PID ${existingPid}). ` +
          `Stop it first, or remove ${lockPath} if the process is no longer running.`,
      );
    }
    // Stale lock from a crashed process — remove it.
  }

  writeFileSync(lockPath, String(process.pid), "utf8");

  const release = () => {
    try {
      unlinkSync(lockPath);
    } catch {
      // Best-effort — lock file may already be gone.
    }
  };

  process.on("exit", release);
  return release;
};
