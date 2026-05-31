<div align="center">

# sentiph

<strong>Orchestrate Claude Code sessions from a live canvas.</strong>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

`sentiph` is a local runtime for orchestrating Claude Code agents. You start sessions, assign them work, connect them into pipelines, and watch them coordinate — all from a single canvas. The key idea is that agents can direct other agents: an orchestrator spawns workers, delegates tasks, monitors progress, and passes messages between sessions without you manually switching terminals.

## What it does

- **Orchestration canvas.** Each Claude Code session is a node on a physics-simulated canvas. An orchestrator agent can spawn child workers, assign them tasks via the inter-agent message channel, and receive their results — forming a live graph of coordinated sessions. Workers can themselves spawn sub-workers, so the canvas reflects the actual delegation tree as it grows.
- **Deterministic build pipelines.** Trigger a `build → check → fix` pipeline run directly from the canvas. Each run spawns a dedicated worker node whose stage strip animates in real time — build passes, checks highlight issues, fixes retry automatically, and the result surfaces back to the orchestrator.
- **Model and effort control.** Choose the Claude model and effort level per agent when creating a session through the canvas dialog.
- **Activity.** Surfaces recent git commits alongside Claude and Codex token usage, with a live commit sparkline in the status strip.
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
