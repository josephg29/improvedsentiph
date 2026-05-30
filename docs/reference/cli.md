# CLI Reference

The command is `sentiph`.

## Start the dashboard

```bash
sentiph
```

Starts the local API for the current project and opens the UI when bundled web assets are present.

If the current directory has not been initialized yet, `sentiph` also creates or updates the local `.sentiph/` scaffold automatically on first run.

## Initialize a project

```bash
sentiph init [project-name]
```

Creates or updates the `.sentiph/` scaffold in the current directory without starting the dashboard.

Use this when you want to initialize the project explicitly or set the project display name ahead of time. In normal use, running `sentiph` inside the codebase is enough to initialize and start the app.

## List registered projects

```bash
sentiph projects
```

## Create an agent

```bash
sentiph terminal create [options]
```

Options:

- `--name`, `-n`: agent display name
- `--workspace-mode`, `-w`: `shared` or `worktree`
- `--initial-prompt`, `-p`: raw initial instruction text
- `--terminal-id`: explicit agent ID
- `--worktree-id`: explicit worktree ID
- `--parent-terminal-id`: parent agent ID for child agents

`sentiph` must already be running for this command.

## List agents

```bash
sentiph terminal list
```

Shows each agent ID, lifecycle state, recorded process ID when available, lifecycle reason, and display name.

## Stop or kill an agent

```bash
sentiph terminal stop <agent-id>
sentiph terminal kill <agent-id>
```

`stop` closes an active session or sends `SIGTERM` to the recorded process for a stale agent. `kill` uses `SIGKILL`.

## Prune inactive agent records

```bash
sentiph terminal prune
```

Removes agent records whose lifecycle state is `stale`, `stopped`, or `exited`. It does not remove active sessions.

## Send a message

```bash
sentiph channel send <agent-id> "message"
```

Use `--from <agent-id>` when sending on behalf of a worker or parent agent. If `--from` is omitted, the CLI falls back to `SENTIPH_SESSION_ID` when the command is running inside a `sentiph`-managed agent.

## List messages

```bash
sentiph channel list <agent-id>
```
