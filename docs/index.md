# sentiph Docs

These docs are written for contributors and future coding agents. They explain how `sentiph` is put together, where state lives, and how local Claude Code agents are coordinated on the canvas.

`sentiph` has two main layers:

- **runtime state** under `~/.sentiph/projects/<project-id>/state/`, which tracks agents, UI state, transcripts, and app metadata
- **live sessions** in the API process, where WebSocket connections are attached to PTY-backed Claude Code agents shown as nodes on the canvas

A small project-local scaffold lives in `.sentiph/` inside the workspace and holds the stable project ID and any isolated worktree checkouts.

## Start here

- [Installation](getting-started/installation.md)
- [Quickstart](getting-started/quickstart.md)
- [Mental Model](concepts/mental-model.md) explains the boundaries between agents, worktrees, and runtime state

## Concepts

- [Runtime and API](concepts/runtime-and-api.md) explains agent lifecycle, WebSockets, hooks, persistence, and restart behavior
- [Pipelines](concepts/pipelines.md) explains deterministic `build → check → fix` runs, recipes, the picker, and the human gate

## Guides

- [Orchestrating Child Agents](guides/orchestrating-child-agents.md) explains parent/worker spawning, shared mode, and worktree mode
- [Inter-Agent Messaging](guides/inter-agent-messaging.md) explains the in-memory channel queue and delivery rules

## Reference

- [CLI](reference/cli.md)
- [Filesystem Layout](reference/filesystem-layout.md)
- [API](reference/api.md)
- [Troubleshooting](reference/troubleshooting.md)

## Contributor policy

- [Contributing](../CONTRIBUTING.md)
