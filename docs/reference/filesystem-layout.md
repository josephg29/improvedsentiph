# Filesystem Layout

`sentiph` splits files by ownership. A small project-local scaffold stays in the workspace. Runtime-owned state stays in the per-project global state directory.

## Project-local files

`.sentiph/` is created in the workspace.

Main paths:

- `.sentiph/project.json`
- `.sentiph/worktrees/`

`project.json` holds the stable project ID used to find global state. Worktrees are generated execution checkouts and should not be treated as durable storage.

Worktree example:

```text
.sentiph/
  project.json
  worktrees/
    api-worker/
```

Project-local Claude Code skills, when present, live under:

```text
.claude/
  skills/
    some-skill/
      SKILL.md
```

## Global state

Per-project runtime state is stored under:

```text
~/.sentiph/projects/<project-id>/state/
```

Notable files:

- the agent registry file
- `transcripts/<sessionId>.jsonl`
- `runs/<runId>.json` and `runs/index.json` (pipeline runs)

Pipeline runs are persisted one file per run under `state/runs/`, with an
`index.json` listing the run ids. Each file is a versioned document holding the
run's status, append-only worker outcome log, and result. Writes are debounced.
On API restart, a run left in a non-terminal status is reconciled to `failed`
with reason `api_restart` — v1 does not resume in-flight runs. Each run also gets
its own isolated worktree under `.sentiph/worktrees/run-<runId>` on branch
`sentiph/run-<runId>`; a passed run's branch is left for you to merge, and a
cancelled/failed run's worktree and branch are removed.

The agent registry stores agent records, lifecycle state, UI state such as node color, parent-child links, workspace mode, worktree IDs, and display names.

`transcripts/*.jsonl` stores transcript events separately from PTY scrollback. Scrollback is in memory and bounded; transcripts are persisted.

## Practical rule

If something is runtime-owned state, expect it under the global project state directory.

If something is an isolated execution checkout, expect it under `.sentiph/worktrees/` and treat its branch lifecycle as part of the agent that created it.
