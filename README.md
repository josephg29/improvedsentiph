<div align="center">

# sentiph

<strong>Launch and watch many Claude Code agents from one local canvas.</strong>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

`sentiph` is a local dashboard for running several Claude Code agents side by side. Each agent shows up as a color-coded circle on a live canvas. One developer can start, watch, steer, and pipeline multiple coding sessions at once.

## What it does

- **Live agent canvas.** Each agent is a node on a physics-simulated canvas. Start a shared-workspace agent or an isolated worktree agent. One orchestrator agent can spawn child workers, assign them tasks, and pass short messages between them.
- **Deterministic build pipelines.** Trigger a `build → check → fix` pipeline run directly from the canvas. Each run spawns a dedicated worker node with an animated stage strip so you can watch the pipeline progress in real time — build passes, checks glow, fixes retry.
- **Model and effort control.** Choose the Claude model and effort level when creating any agent through the canvas dialog.
- **Activity.** A page that surfaces recent git activity alongside Claude and Codex token usage, with a live commit sparkline in the status strip.
- **Settings.** Configure completion sounds, surface visibility (status strip, X Monitor, telemetry tape), and other workspace preferences.

## Quick start

```bash
pnpm install
pnpm dev
```

This starts the local API and web app together.

Requirements:

- Node.js `22+`
- the `claude` CLI for the supported agent workflow
- `git` for isolated worktree agents
- `gh` for GitHub pull request features
- `curl` for the Claude hook callback flow

On first run, `sentiph` creates the local `.sentiph/` scaffold automatically, assigns a stable project ID, picks an available local API port starting at `8787`, and opens the UI unless `SENTIPH_NO_OPEN=1` is set.

## Remote access

By default the API only accepts connections from `localhost`. To open it to other hosts:

```bash
SENTIPH_ALLOW_REMOTE_ACCESS=1 SENTIPH_BEARER_TOKEN=your-secret-token pnpm dev
```

Every non-preflight HTTP request and every WebSocket upgrade must then include:

```
Authorization: Bearer your-secret-token
```

Starting the server with `SENTIPH_ALLOW_REMOTE_ACCESS=1` but no token set prints a warning. Enabling remote access without a token is a security risk — any client on the network can control your agents.

## What persists

- `.sentiph/` is the project-local scaffold in your workspace. It holds the stable project ID and any isolated worktree checkouts.
- `~/.sentiph/projects/<project-id>/state/` holds runtime state: agent records, UI state, transcripts, channel message queues, and the workspace lock file.

**Channel messages** (inter-agent coordination payloads) are written to `state/channels/<terminalId>.jsonl` on every send and reloaded on startup, so queued messages survive an API restart.

**Workspace locking.** The API writes a PID lock at `state/api.lock` on startup and removes it on exit. If a second instance tries to start against the same project directory while the first is still running, it exits immediately with an error. This prevents concurrent writes that could corrupt registry and transcript state.

Live PTY sessions survive a browser reload during the idle grace window but do **not** survive an API restart. On restart, `sentiph` marks previously running agents as `stale`; use `sentiph terminal list`, `stop`, `kill`, and `prune` to inspect and clean them up. Live sessions are capped at 32 by default; set `SENTIPH_MAX_TERMINAL_SESSIONS` to tune that limit.

## Docs

- [Docs Home](docs/index.md)
- [Installation](docs/getting-started/installation.md)
- [Quickstart](docs/getting-started/quickstart.md)
- [Mental Model](docs/concepts/mental-model.md)
- [Runtime and API](docs/concepts/runtime-and-api.md)
- [Orchestrating Child Agents](docs/guides/orchestrating-child-agents.md)
- [Inter-Agent Messaging](docs/guides/inter-agent-messaging.md)
- [CLI Reference](docs/reference/cli.md)
- [Filesystem Layout](docs/reference/filesystem-layout.md)
- [API Reference](docs/reference/api.md)
- [Troubleshooting](docs/reference/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)

## Contributing

`sentiph` is an experimental personal project and is not actively reviewing pull requests right now. If you still open one and any code was written with AI, disclose which coding agent and model were used. See [CONTRIBUTING.md](CONTRIBUTING.md) for workflow and expectations.
