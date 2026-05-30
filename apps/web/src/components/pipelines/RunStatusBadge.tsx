import type { RunStatus } from "@sentiph/core";

type Tone = "muted" | "running" | "passed" | "issues" | "failed";

const STATUS_META: Record<RunStatus, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "muted" },
  building: { label: "Building", tone: "running" },
  checking: { label: "Checking", tone: "running" },
  fixing: { label: "Fixing", tone: "running" },
  awaiting_approval: { label: "Awaiting approval", tone: "issues" },
  passed: { label: "Passed", tone: "passed" },
  completed_with_issues: { label: "Issues", tone: "issues" },
  failed: { label: "Failed", tone: "failed" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const RunStatusBadge = ({ status }: { status: RunStatus }) => {
  const meta = STATUS_META[status];
  return (
    <span className="pipeline-badge" data-tone={meta.tone}>
      {meta.label}
    </span>
  );
};
