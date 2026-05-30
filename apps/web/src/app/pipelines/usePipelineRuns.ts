import type { Run, RunStatus } from "@sentiph/core";
import { useCallback, useEffect, useState } from "react";

import {
  buildRunCancelUrl,
  buildRunItemUrl,
  buildRunsUrl,
  buildTerminalEventsSocketUrl,
} from "../../runtime/runtimeEndpoints";

export interface RunListItem {
  runId: string;
  status: RunStatus;
  task: string;
  recipeId: string;
  createdAt: string;
  updatedAt: string;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const toListItem = (run: RunListItem | Run): RunListItem => ({
  runId: run.runId,
  status: run.status,
  task: run.task,
  recipeId: run.recipeId,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt,
});

const parseRunUpdated = (data: string): Run | null => {
  try {
    const payload = JSON.parse(data) as { type?: unknown; run?: unknown };
    if (payload?.type === "run-updated" && payload.run && typeof payload.run === "object") {
      return payload.run as Run;
    }
  } catch {
    // Non-JSON or unrelated terminal events — ignore.
  }
  return null;
};

export interface UsePipelineRuns {
  runs: RunListItem[];
  selectedRunId: string | null;
  selectedRun: Run | null;
  isStarting: boolean;
  error: string | null;
  startRun: (task: string, recipeId?: string) => Promise<void>;
  cancelRun: (runId: string) => Promise<void>;
  selectRun: (runId: string) => Promise<void>;
}

export const usePipelineRuns = (): UsePipelineRuns => {
  const [summaries, setSummaries] = useState<Record<string, RunListItem>>({});
  const [details, setDetails] = useState<Record<string, Run>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const upsertRun = useCallback((run: Run) => {
    setSummaries((current) => ({ ...current, [run.runId]: toListItem(run) }));
    setDetails((current) => ({ ...current, [run.runId]: run }));
  }, []);

  // Initial list.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(buildRunsUrl());
        if (!response.ok) {
          throw new Error(`Failed to load runs (${response.status}).`);
        }
        const list = (await response.json()) as RunListItem[];
        if (!cancelled) {
          setSummaries(Object.fromEntries(list.map((item) => [item.runId, toListItem(item)])));
        }
      } catch (caught) {
        if (!cancelled) {
          setError(messageOf(caught));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates over the shared terminal-event socket.
  useEffect(() => {
    const socket = new WebSocket(buildTerminalEventsSocketUrl());
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }
      const run = parseRunUpdated(event.data);
      if (run) {
        upsertRun(run);
      }
    };
    socket.addEventListener("message", onMessage);
    return () => {
      socket.removeEventListener("message", onMessage);
      socket.close();
    };
  }, [upsertRun]);

  const selectRun = useCallback(
    async (runId: string) => {
      setSelectedRunId(runId);
      try {
        const response = await fetch(buildRunItemUrl(runId));
        if (response.ok) {
          upsertRun((await response.json()) as Run);
        }
      } catch (caught) {
        setError(messageOf(caught));
      }
    },
    [upsertRun],
  );

  const startRun = useCallback(async (task: string, recipeId?: string) => {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch(buildRunsUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, ...(recipeId ? { recipeId } : {}) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Failed to start run (${response.status}).`);
      }
      const { runId } = (await response.json()) as { runId: string };
      setSelectedRunId(runId);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setIsStarting(false);
    }
  }, []);

  const cancelRun = useCallback(async (runId: string) => {
    try {
      await fetch(buildRunCancelUrl(runId), { method: "POST" });
    } catch (caught) {
      setError(messageOf(caught));
    }
  }, []);

  const runs = Object.values(summaries).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
  const selectedRun = selectedRunId ? (details[selectedRunId] ?? null) : null;

  return { runs, selectedRunId, selectedRun, isStarting, error, startRun, cancelRun, selectRun };
};
