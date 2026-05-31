import { useState } from "react";
import type { TerminalWorkspaceMode } from "../../app/types";

export type CreateTerminalOptions = {
  workspaceMode: TerminalWorkspaceMode;
  model: "sonnet" | "opus" | "haiku";
  effort: "low" | "medium" | "high";
};

type CreateTerminalDialogProps = {
  onConfirm: (options: CreateTerminalOptions) => void;
  onCancel: () => void;
};

const MODEL_OPTIONS: { value: CreateTerminalOptions["model"]; label: string; desc: string }[] = [
  { value: "sonnet", label: "Sonnet", desc: "Fast, balanced — recommended for most tasks" },
  { value: "opus", label: "Opus", desc: "Most capable — best for complex reasoning" },
  { value: "haiku", label: "Haiku", desc: "Fastest and lightest — simple tasks" },
];

const EFFORT_OPTIONS: { value: CreateTerminalOptions["effort"]; label: string; desc: string }[] = [
  { value: "medium", label: "Medium", desc: "Default — balanced exploration" },
  { value: "high", label: "High", desc: "More thorough — longer tasks" },
  { value: "low", label: "Low", desc: "Quick — minimal back-and-forth" },
];

export const CreateTerminalDialog = ({ onConfirm, onCancel }: CreateTerminalDialogProps) => {
  const [workspaceMode, setWorkspaceMode] = useState<TerminalWorkspaceMode>("shared");
  const [model, setModel] = useState<CreateTerminalOptions["model"]>("sonnet");
  const [effort, setEffort] = useState<CreateTerminalOptions["effort"]>("medium");

  return (
    <div className="create-terminal-dialog-backdrop" onClick={onCancel}>
      <div
        className="create-terminal-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="create-terminal-dialog__title">New Agent</h3>

        <div className="create-terminal-dialog__field">
          <label className="create-terminal-dialog__label">Workspace</label>
          <div className="create-terminal-dialog__radio-group">
            <label className={`create-terminal-dialog__radio${workspaceMode === "shared" ? " create-terminal-dialog__radio--selected" : ""}`}>
              <input
                type="radio"
                name="workspaceMode"
                value="shared"
                checked={workspaceMode === "shared"}
                onChange={() => setWorkspaceMode("shared")}
              />
              <span className="create-terminal-dialog__radio-label">Shared</span>
              <span className="create-terminal-dialog__radio-desc">Reads and writes in the main workspace</span>
            </label>
            <label className={`create-terminal-dialog__radio${workspaceMode === "worktree" ? " create-terminal-dialog__radio--selected" : ""}`}>
              <input
                type="radio"
                name="workspaceMode"
                value="worktree"
                checked={workspaceMode === "worktree"}
                onChange={() => setWorkspaceMode("worktree")}
              />
              <span className="create-terminal-dialog__radio-label">Worktree</span>
              <span className="create-terminal-dialog__radio-desc">Isolated git branch — safe for parallel edits</span>
            </label>
          </div>
        </div>

        <div className="create-terminal-dialog__field">
          <label className="create-terminal-dialog__label">Model</label>
          <div className="create-terminal-dialog__select-group">
            {MODEL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`create-terminal-dialog__select-option${model === opt.value ? " create-terminal-dialog__select-option--selected" : ""}`}
                onClick={() => setModel(opt.value)}
              >
                <span className="create-terminal-dialog__select-name">{opt.label}</span>
                <span className="create-terminal-dialog__select-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="create-terminal-dialog__field">
          <label className="create-terminal-dialog__label">Effort</label>
          <div className="create-terminal-dialog__select-group">
            {EFFORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`create-terminal-dialog__select-option${effort === opt.value ? " create-terminal-dialog__select-option--selected" : ""}`}
                onClick={() => setEffort(opt.value)}
              >
                <span className="create-terminal-dialog__select-name">{opt.label}</span>
                <span className="create-terminal-dialog__select-desc">{opt.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="create-terminal-dialog__actions">
          <button type="button" className="create-terminal-dialog__btn create-terminal-dialog__btn--cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="create-terminal-dialog__btn create-terminal-dialog__btn--confirm"
            onClick={() => onConfirm({ workspaceMode, model, effort })}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
};
