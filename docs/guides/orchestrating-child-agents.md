# Orchestrating Child Agents

`sentiph` uses child agents to split work into parallel streams.

## How spawning works

A child agent is a normal agent record with `parentTerminalId` set. The relationship is stored in the agent registry and shown on the canvas as a node linked to its parent; the child still has its own agent ID, lifecycle state, transcript, workspace mode, and optional worktree.

A parent agent creates child agents by resolving prompt templates. The prompt receives the scoped task, the path to the workspace, the agent ID, the API port, workspace guidance, and the parent agent ID.

## When to use child agents

Use child agents when:

- tasks are independent enough to run in parallel
- the parent can define clean scopes
- each task is narrow and self-contained
- the expected file overlap is low or worktree mode is available

Do not use them when the work is too entangled and the agents will overwrite each other.

## Recommended workflow

1. pick the parent agent that owns the job
2. define clear, narrow tasks for each worker
3. spawn worker agents for those tasks
4. review results in the parent agent
5. use channel messages when workers need to coordinate

## Shared vs worktree

Use `shared` when:

- the tasks are read-heavy
- the changes are small
- you want fast setup

Use `worktree` when:

- the tasks touch overlapping files
- you want clean git isolation
- you expect larger code edits

In shared mode, workers all run in the main workspace and are told not to commit. This is faster but relies on careful scoping and review.

In worktree mode, each worker gets a branch named `sentiph/<worker-agent-id>` under `.sentiph/worktrees/<worker-agent-id>/` and is told to commit its work. The parent coordinator is responsible for merging branches and running tests.

## Parent coordinator behavior

When a parent fans out to more than one worker, `sentiph` creates a coordinator-shaped prompt for the parent. The parent prompt contains:

- the list of worker agent IDs and their assigned tasks
- commands for creating each worker agent
- communication instructions for `sentiph channel send`
- a completion strategy for shared mode or worktree mode
- the final requirement to review and test

The parent is intentionally not a magic scheduler. It is an agent session with explicit instructions and a visible node on the canvas. That makes orchestration inspectable and interruptible.

## Worker limits and identity

Each parent can have up to 9 child agents. If a job has more tasks than that, `sentiph` uses task order as priority order and defers the overflow.

Worker agent IDs are derived from the parent and task index. That makes duplicate detection simple: `sentiph` refuses to start a second active worker for the same task pattern.

## Limits

- PTY sessions do not survive API restarts
- channel messages are in-memory only
- delegation quality depends on how clearly each task is scoped
- shared-mode workers can still collide in files, because shared mode is not git isolation
- worktree-mode workers still need a human or parent merge step before their work reaches the base branch
