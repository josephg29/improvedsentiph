import { useEffect, useRef, useState } from "react";

import type { ClaudeUsageSnapshot } from "../app/types";

type RuntimeStatusStripProps = {
  claudeUsage: ClaudeUsageSnapshot | null;
  isRefreshingClaudeUsage?: boolean;
  onRefreshClaudeUsage?: () => void;
};

const pct = (value: number | null | undefined, loading?: boolean): string => {
  if (loading) return "···";
  return value == null ? "NA" : `${Math.round(value)}%`;
};

const usageState = (
  claudeUsage: ClaudeUsageSnapshot | null,
): {
  label: string;
  loading: boolean;
  sessionPercent: number | null | undefined;
  weekPercent: number | null | undefined;
  message?: string;
} => {
  if (claudeUsage === null) {
    return {
      label: "Session",
      loading: true,
      sessionPercent: 0,
      weekPercent: 0,
    };
  }

  const label = claudeUsage.source === "oauth-api" ? "5h" : "Session";
  if (claudeUsage.status === "ok") {
    return {
      label,
      loading: false,
      sessionPercent: claudeUsage.primaryUsedPercent,
      weekPercent: claudeUsage.secondaryUsedPercent,
    };
  }

  return {
    label,
    loading: false,
    sessionPercent: null,
    weekPercent: null,
    message: claudeUsage.message ?? "Claude usage unavailable",
  };
};

const UsageRail = ({
  label,
  percent,
  loading,
  title,
}: {
  label: string;
  percent: number | null | undefined;
  loading?: boolean;
  title?: string;
}) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);

  const showTooltip = (clientX: number, clientY: number) => {
    if (!title) return;
    setTooltip({ x: clientX, y: clientY });
  };

  return (
    <div
      className="console-status-usage-row"
      data-has-tooltip={title ? "true" : undefined}
      tabIndex={title ? 0 : -1}
      onMouseEnter={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseMove={(event) => showTooltip(event.clientX, event.clientY)}
      onMouseLeave={() => setTooltip(null)}
      onBlur={() => setTooltip(null)}
      onFocus={(event) => {
        if (!title) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setTooltip({ x: rect.left + 24, y: rect.bottom + 8 });
      }}
    >
      <span className="console-status-usage-row-meta">
        <span className="console-status-usage-row-label">{label}</span>
        <span className="console-status-usage-row-value">{pct(percent, loading)}</span>
      </span>
      <span className="console-status-usage-rail">
        <span
          className="console-status-usage-rail-fill"
          style={{ width: `${Math.min(100, percent ?? 0)}%` }}
        />
      </span>
      {title && tooltip ? (
        <span
          className="console-status-usage-tooltip"
          style={{
            left: `${Math.max(8, tooltip.x - 260)}px`,
            top: `${Math.min(window.innerHeight - 80, tooltip.y + 14)}px`,
          }}
        >
          {title}
        </span>
      ) : null}
    </div>
  );
};

export const RuntimeStatusStrip = ({
  claudeUsage,
  isRefreshingClaudeUsage = false,
  onRefreshClaudeUsage,
}: RuntimeStatusStripProps) => {
  const claudeUsageState = usageState(claudeUsage);
  const [showRefreshSpin, setShowRefreshSpin] = useState(false);
  const refreshStartedAtRef = useRef<number | null>(null);
  const refreshHideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isRefreshingClaudeUsage) {
      if (refreshHideTimerRef.current !== null) {
        window.clearTimeout(refreshHideTimerRef.current);
        refreshHideTimerRef.current = null;
      }
      refreshStartedAtRef.current = Date.now();
      setShowRefreshSpin(true);
      return;
    }

    if (refreshStartedAtRef.current === null) {
      setShowRefreshSpin(false);
      return;
    }

    const elapsedMs = Date.now() - refreshStartedAtRef.current;
    const remainingMs = Math.max(0, 450 - elapsedMs);
    refreshHideTimerRef.current = window.setTimeout(() => {
      setShowRefreshSpin(false);
      refreshStartedAtRef.current = null;
      refreshHideTimerRef.current = null;
    }, remainingMs);
  }, [isRefreshingClaudeUsage]);

  return (
    <section className="console-status-strip" aria-label="Runtime status strip">
      <div className="console-status-main">
        <span className="console-status-brand">sentiph</span>
        <span className="console-status-sub">open source · MIT</span>
      </div>
      <div className="console-status-claude-usage" aria-label="Claude usage limits">
        {onRefreshClaudeUsage && (
          <button
            type="button"
            className="console-status-claude-usage-refresh"
            onClick={onRefreshClaudeUsage}
            aria-label="Refresh Claude usage"
            title="Refresh Claude usage"
            data-refreshing={showRefreshSpin ? "true" : "false"}
          >
            ↻
          </button>
        )}
        <span className="console-status-claude-usage-title">
          CLAUDE
          <br />
          USAGE
        </span>
        <div className="console-status-claude-usage-bars">
          <UsageRail
            label={claudeUsageState.label}
            percent={claudeUsageState.sessionPercent}
            loading={claudeUsageState.loading}
            {...(claudeUsageState.message ? { title: claudeUsageState.message } : {})}
          />
          <UsageRail
            label="Week (all)"
            percent={claudeUsageState.weekPercent}
            loading={claudeUsageState.loading}
            {...(claudeUsageState.message ? { title: claudeUsageState.message } : {})}
          />
        </div>
      </div>
    </section>
  );
};
