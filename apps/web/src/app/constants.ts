export const CODEX_USAGE_SCAN_INTERVAL_MS = 600_000;
export const GITHUB_SUMMARY_SCAN_INTERVAL_MS = 60_000;
export const BACKEND_LIVENESS_SCAN_INTERVAL_MS = 120_000;
export const UI_STATE_SAVE_DEBOUNCE_MS = 250;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 520;

export const PRIMARY_NAV_ITEMS = [
  { index: 1, label: "Agents" },
  { index: 2, label: "Pipelines" },
  { index: 3, label: "Activity" },
  { index: 8, label: "Settings" },
] as const;

export const GITHUB_COMMIT_SERIES_LENGTH = 30;
export const GITHUB_SPARKLINE_WIDTH = 148;
export const GITHUB_SPARKLINE_HEIGHT = 36;
export const GITHUB_OVERVIEW_GRAPH_WIDTH = 640;
export const GITHUB_OVERVIEW_GRAPH_HEIGHT = 180;

// Max valid index (not array length) so removed middle tabs don't invalidate
// higher indices like Settings (8).
export const PRIMARY_NAV_MAX = Math.max(...PRIMARY_NAV_ITEMS.map((item) => item.index));

export type PrimaryNavIndex = (typeof PRIMARY_NAV_ITEMS)[number]["index"];
