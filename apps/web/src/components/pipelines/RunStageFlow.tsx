import type { Run } from "@sentiph/core";

import { stageProgress } from "../../app/pipelines/stageProgress";

const DONE_LABEL: Record<string, string> = {
  passed: "Passed",
  completed_with_issues: "Issues",
  failed: "Failed",
  cancelled: "Cancelled",
};

const doneTone = (run: Run): string => {
  switch (run.status) {
    case "passed":
      return "done";
    case "completed_with_issues":
      return "issues";
    case "failed":
      return "failed";
    case "cancelled":
      return "pending";
    default:
      return "active";
  }
};

export const RunStageFlow = ({ run }: { run: Run }) => {
  const stages = stageProgress(run);
  const finalLabel = DONE_LABEL[run.status] ?? "Done";

  return (
    <ol className="pipeline-stage-flow" aria-label="Pipeline stages">
      {stages.map((stage) => (
        <li className="pipeline-stage-node" data-state={stage.state} key={stage.role}>
          <span className="pipeline-stage-dot" aria-hidden="true" />
          <span className="pipeline-stage-label">{stage.label}</span>
        </li>
      ))}
      <li className="pipeline-stage-node pipeline-stage-node--terminal" data-state={doneTone(run)}>
        <span className="pipeline-stage-dot" aria-hidden="true" />
        <span className="pipeline-stage-label">{finalLabel}</span>
      </li>
    </ol>
  );
};
