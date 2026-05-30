# API Reference

`sentiph` exposes a local HTTP and WebSocket API.

The API has two different kinds of state:

- persisted project state, such as agent records, UI state, and transcripts
- in-memory runtime state, such as live PTYs, attached WebSockets, scrollback, and channel queues

Most HTTP routes either read/write persisted files or create runtime records. WebSocket routes attach clients to live PTY sessions owned by the API process.

## Agents

- `GET /api/terminal-snapshots` - returns the current agent list and snapshot state for the canvas
- `POST /api/terminals` - creates a new agent session
- `POST /api/terminals/prune` - removes agent records with `stale`, `stopped`, or `exited` lifecycle state
- `PATCH /api/terminals/:terminalId` - updates agent metadata such as the display name
- `DELETE /api/terminals/:terminalId` - removes an agent and closes its active session
- `POST /api/terminals/:terminalId/stop` - stops an active session or recorded stale process
- `POST /api/terminals/:terminalId/kill` - kills an active session or recorded stale process
- `WS /api/terminals/:terminalId/ws` - streams live agent IO over WebSocket

Agent snapshots include `lifecycleState` when known. Supported lifecycle states are `registered`, `running`, `stopped`, `exited`, and `stale`. Stale agents are records that were persisted as running but could not be reattached to a live session after startup.

Creating an agent registers metadata first. A PTY starts immediately only when an initial prompt is provided, a WebSocket attaches, or an internal direct listener starts the session. Worktree-backed agents also create their worktree before the agent record is exposed.

## Git and worktrees

These routes operate on a worktree-backed agent, keyed by its ID.

- `GET /api/terminals/:terminalId/git/status` - reads git status for the agent worktree
- `POST /api/terminals/:terminalId/git/commit` - creates a commit from the agent worktree
- `POST /api/terminals/:terminalId/git/push` - pushes the agent branch
- `POST /api/terminals/:terminalId/git/sync` - syncs the agent worktree with its base branch
- `GET /api/terminals/:terminalId/git/pr` - reads pull request information for the agent branch
- `POST /api/terminals/:terminalId/git/pr/merge` - merges the agent pull request

## Channels

- `GET /api/channels/:terminalId/messages` - lists messages for one agent channel
- `POST /api/channels/:terminalId/messages` - sends a message to one agent channel

Channel messages are queued in memory. The POST body provides `fromTerminalId` and `content`; delivery injects pending messages into the target agent input when the target session is idle.

## Hooks

- `POST /api/hooks/:hookName` - ingests lifecycle events coming from Claude Code hooks

Current hook names:

- `session-start`
- `user-prompt-submit`
- `pre-tool-use`
- `notification`
- `stop`

## Activity

- `GET /api/codex/usage` - returns Codex token usage data when available
- `GET /api/claude/usage` - returns Claude token usage data when available
- `GET /api/github/summary` - returns the git/GitHub activity summary for the workspace
- `GET /api/analytics/usage-heatmap?scope=all|project` - returns heatmap data from Claude session history

## UI state

- `GET /api/ui-state` - reads the persisted UI state for the current project
- `PATCH /api/ui-state` - updates the persisted UI state

## Workspace setup

- `GET /api/setup` - reads the verified first-run setup status for the current workspace
- `POST /api/setup/steps/:stepId` - runs one setup step and returns the refreshed setup snapshot

## Pipelines

A pipeline runs one task through a deterministic `build → check → fix → done`
routine. The steps are driven by `sentiph` itself (a pure, tested conductor); the
work inside each step is done by a headless `claude -p` worker whose output is
JSON-schema-validated before it can affect routing.

- `POST /api/runs` - starts a run from `{ task, recipeId? }` and returns `{ runId, status }`. When `recipeId` is omitted or `"auto"`, a deterministic picker selects the recipe from the task.
- `GET /api/runs` - lists run summaries (`runId`, `status`, `task`, `recipeId`, timestamps)
- `GET /api/runs/:runId` - returns the full run, including the append-only worker outcome log and the converged result
- `POST /api/runs/:runId/cancel` - aborts in-flight workers and cleans up the run worktree
- `POST /api/runs/:runId/approve` - approves a run paused at a human gate (the `careful` recipe)
- `POST /api/runs/:runId/reject` - rejects a run paused at a human gate
- `GET /api/recipes` - lists the available recipes and their stage roles

Run status moves through `pending → building → checking → fixing →
awaiting_approval` and ends at one of `passed`, `completed_with_issues`,
`failed`, or `cancelled`. Live updates are pushed as `run-updated` events over
the existing `WS /api/terminal-events/ws` channel. A passed run leaves its
`sentiph/run-<id>` branch for you to review and merge.

## Request limits and defaults

- JSON request bodies are capped at `1 MiB`
- invalid JSON returns `400`
- unsupported methods return `405`
- the server binds to loopback by default
