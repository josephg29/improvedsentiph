import type { IssueFinding, Run } from "@sentiph/core";

import { RunStageFlow } from "./RunStageFlow";
import { RunStatusBadge } from "./RunStatusBadge";

const ACTIVE_STATUSES = new Set(["pending", "building", "checking", "fixing"]);

const IssueList = ({ title, issues }: { title: string; issues: IssueFinding[] }) => {
  if (issues.length === 0) {
    return null;
  }
  return (
    <div className="pipeline-issue-group">
      <h4 className="pipeline-issue-title">
        {title} ({issues.length})
      </h4>
      <ul className="pipeline-issue-list">
        {issues.map((issue, index) => (
          <li
            className="pipeline-issue"
            data-severity={issue.severity}
            key={`${issue.location}-${index}`}
          >
            <span className="pipeline-issue-severity">{issue.severity}</span>
            <span className="pipeline-issue-location">{issue.location}</span>
            <span className="pipeline-issue-problem">{issue.problem}</span>
            {issue.suggestion ? (
              <span className="pipeline-issue-suggestion">→ {issue.suggestion}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface RunDetailProps {
  run: Run;
  onCancel: (runId: string) => void;
}

export const RunDetail = ({ run, onCancel }: RunDetailProps) => {
  const isActive = ACTIVE_STATUSES.has(run.status);
  const result = run.result;

  return (
    <article className="pipeline-detail">
      <header className="pipeline-detail-header">
        <div className="pipeline-detail-heading">
          <RunStatusBadge status={run.status} />
          <span className="pipeline-detail-id">{run.runId}</span>
        </div>
        {isActive ? (
          <button
            className="pipeline-cancel-button"
            onClick={() => onCancel(run.runId)}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </header>

      <p className="pipeline-detail-task">{run.task}</p>

      <RunStageFlow run={run} />

      {run.workspaceBranch ? (
        <p className="pipeline-detail-branch">
          Branch <code>{run.workspaceBranch}</code>
        </p>
      ) : null}

      {run.failureReason ? (
        <p className="pipeline-detail-failure">Failure: {run.failureReason}</p>
      ) : null}

      {result ? (
        <section className="pipeline-detail-result">
          {result.taskSummary ? (
            <p className="pipeline-result-summary">{result.taskSummary}</p>
          ) : null}
          {result.filesTouched.length > 0 ? (
            <p className="pipeline-result-files">Files: {result.filesTouched.join(", ")}</p>
          ) : null}
          <IssueList title="Found" issues={result.issuesFound} />
          <IssueList title="Fixed" issues={result.issuesFixed} />
          <IssueList title="Remaining" issues={result.issuesRemaining} />
        </section>
      ) : null}

      {run.outcomes.length > 0 ? (
        <section className="pipeline-detail-log">
          <h4 className="pipeline-issue-title">Worker log ({run.outcomes.length})</h4>
          <ul className="pipeline-outcome-list">
            {run.outcomes.map((outcome, index) => (
              <li
                className="pipeline-outcome"
                data-ok={outcome.ok ? "true" : "false"}
                key={`${outcome.stageId}-${outcome.index}-${index}`}
              >
                <span className="pipeline-outcome-stage">{outcome.stageId}</span>
                <span className="pipeline-outcome-result">
                  {outcome.ok ? "ok" : (outcome.error ?? "failed")}
                </span>
                {typeof outcome.costUsd === "number" ? (
                  <span className="pipeline-outcome-cost">${outcome.costUsd.toFixed(2)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
};
