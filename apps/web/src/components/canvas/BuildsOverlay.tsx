import { usePipelineRuns } from "../../app/pipelines/usePipelineRuns";
import { RunStageFlow } from "../pipelines/RunStageFlow";
import { RunStatusBadge } from "../pipelines/RunStatusBadge";

/**
 * Floating panel on the orchestration canvas showing the pipeline builds the
 * orchestrator has delegated. Each build is a worker run (build → check → fix)
 * under its parent terminal, streamed live — so building shows up as the
 * orchestrator's work, not a separate feature.
 */
export const BuildsOverlay = () => {
  const { runs, selectedRun, selectRun, cancelRun, approveRun, rejectRun } = usePipelineRuns();

  if (runs.length === 0) {
    return null;
  }

  return (
    <aside className="builds-overlay" aria-label="Pipeline builds">
      <header className="builds-overlay-header">
        <span className="builds-overlay-title">Builds</span>
        <span className="builds-overlay-count">{runs.length}</span>
      </header>
      <ul className="builds-overlay-list">
        {runs.map((run) => {
          const detail = selectedRun?.runId === run.runId ? selectedRun : null;
          return (
            <li className="builds-overlay-item" key={run.runId}>
              <button
                className="builds-overlay-row"
                data-selected={detail ? "true" : "false"}
                onClick={() => void selectRun(run.runId)}
                type="button"
              >
                <RunStatusBadge status={run.status} />
                <span className="builds-overlay-task">{run.task}</span>
              </button>
              {run.parentTerminalId ? (
                <span className="builds-overlay-parent">↳ {run.parentTerminalId}</span>
              ) : null}
              {detail ? (
                <div className="builds-overlay-detail">
                  <RunStageFlow run={detail} />
                  {detail.status === "awaiting_approval" ? (
                    <div className="builds-overlay-actions">
                      <button
                        className="builds-overlay-approve"
                        onClick={() => void approveRun(detail.runId)}
                        type="button"
                      >
                        Approve
                      </button>
                      <button
                        className="builds-overlay-cancel"
                        onClick={() => void rejectRun(detail.runId)}
                        type="button"
                      >
                        Reject
                      </button>
                    </div>
                  ) : ["pending", "building", "checking", "fixing"].includes(detail.status) ? (
                    <div className="builds-overlay-actions">
                      <button
                        className="builds-overlay-cancel"
                        onClick={() => void cancelRun(detail.runId)}
                        type="button"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : detail.result?.taskSummary ? (
                    <p className="builds-overlay-summary">{detail.result.taskSummary}</p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
};
