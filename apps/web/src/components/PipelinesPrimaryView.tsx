import { type FormEvent, useState } from "react";

import { usePipelineRuns } from "../app/pipelines/usePipelineRuns";
import { RunDetail } from "./pipelines/RunDetail";
import { RunStatusBadge } from "./pipelines/RunStatusBadge";

const NewRunForm = ({
  isStarting,
  onStart,
}: {
  isStarting: boolean;
  onStart: (task: string) => void;
}) => {
  const [task, setTask] = useState("");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = task.trim();
    if (!trimmed || isStarting) {
      return;
    }
    onStart(trimmed);
    setTask("");
  };

  return (
    <form className="pipeline-new-run" onSubmit={handleSubmit}>
      <label className="pipeline-new-run-label" htmlFor="pipeline-task">
        New pipeline run
      </label>
      <textarea
        className="pipeline-new-run-input"
        id="pipeline-task"
        onChange={(event) => setTask(event.target.value)}
        placeholder="Describe the task to build → check → fix…"
        rows={3}
        value={task}
      />
      <button
        className="pipeline-new-run-button"
        disabled={isStarting || task.trim().length === 0}
        type="submit"
      >
        {isStarting ? "Starting…" : "Run pipeline"}
      </button>
    </form>
  );
};

export const PipelinesPrimaryView = () => {
  const { runs, selectedRunId, selectedRun, isStarting, error, startRun, cancelRun, selectRun } =
    usePipelineRuns();

  return (
    <section className="pipelines-view" aria-label="Pipelines">
      <header className="pipelines-view-header">
        <h2 className="pipelines-view-title">Pipelines</h2>
        <p className="pipelines-view-subtitle">
          Deterministic build → check → fix runs. Headless workers do the work; the conductor
          decides the route.
        </p>
      </header>

      <div className="pipelines-body">
        <aside className="pipelines-list" aria-label="Runs">
          <NewRunForm isStarting={isStarting} onStart={(task) => void startRun(task)} />
          {error ? <p className="pipelines-error">{error}</p> : null}
          <ul className="pipeline-run-rows">
            {runs.length === 0 ? (
              <li className="pipelines-empty">No runs yet.</li>
            ) : (
              runs.map((run) => (
                <li key={run.runId}>
                  <button
                    className="pipeline-run-row"
                    data-selected={run.runId === selectedRunId ? "true" : "false"}
                    onClick={() => void selectRun(run.runId)}
                    type="button"
                  >
                    <RunStatusBadge status={run.status} />
                    <span className="pipeline-run-row-task">{run.task}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </aside>

        <main className="pipelines-detail">
          {selectedRun ? (
            <RunDetail onCancel={(runId) => void cancelRun(runId)} run={selectedRun} />
          ) : (
            <div className="pipelines-detail-empty">
              {selectedRunId
                ? "Loading run…"
                : "Select a run to watch its build → check → fix flow."}
            </div>
          )}
        </main>
      </div>
    </section>
  );
};
