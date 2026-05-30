<div align="center">

# sentiph

<strong>Launch and watch many Claude Code agents from one local canvas.</strong>

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22+-5FA04E?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

`sentiph` is a thin local dashboard for running several Claude Code agents side by side. Each agent shows up as a color-coded circle node on a live canvas, so one developer can start, watch, and steer multiple coding sessions at once.

## What it does

- **Launch and coordinate multiple Claude Code agents on a live canvas.** Each agent is a color-coded circle node you can start, watch, and stop. One Claude Code agent can also spawn child agents, assign them work, and pass short messages between them.
- **Activity.** A page that surfaces recent git activity for the workspace alongside Claude and Codex token usage.
- **Settings.** A page for configuring the local app and its integrations.

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

## What persists

- `.sentiph/` is the project-local scaffold created in your workspace. It holds the stable project ID and any isolated worktree checkouts.
- `~/.sentiph/projects/<project-id>/state/` holds runtime state and metadata: agent records, lifecycle state, UI state, and transcripts.

Live PTY sessions survive a browser reload during the idle grace window, but they do **not** survive an API restart. On startup, `sentiph` marks previously running agent records as `stale` when it cannot reattach them to a live session; use `sentiph terminal list`, `stop`, `kill`, and `prune` to inspect and clean them up. Live sessions are capped at 32 by default; set `SENTIPH_MAX_TERMINAL_SESSIONS` to a positive integer to tune that limit.

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
