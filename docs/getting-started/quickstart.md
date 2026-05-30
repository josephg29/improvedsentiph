# Quickstart

This is the shortest useful path through the project.

## 1. Start the app

For local development:

```bash
pnpm install
pnpm dev
```

For a local global CLI install from a clone:

```bash
pnpm install
pnpm build
npm install -g .
sentiph
```

`sentiph` is not published to npm yet, so `npm install -g sentiph` is not currently a valid quick start path.

On a fresh workspace, `sentiph` opens a first-run setup card. The card verifies the workspace files, `.gitignore`, and local prerequisites before you launch any agents.

## 2. Launch an agent

Each agent appears as a color-coded circle node on the live canvas. Create one from the UI, or from the CLI while the app is running:

```bash
sentiph terminal create --name "API worker"
```

Use `--workspace-mode worktree` if you want the agent to run in an isolated git worktree.

## 3. Watch it on the canvas

The new agent shows up as a node. Click it to attach to its live session, read its output, and steer it. Node color and state reflect what the agent is doing.

## 4. Spawn child agents

One Claude Code agent can coordinate others. A parent agent can spawn child agents, give each a scoped task, and supervise the result. Each child is its own node with its own session, lifecycle state, and optional worktree.

## 5. Send a message

```bash
sentiph channel send terminal-2 "Need review on the request parser changes"
```

## What to verify

- the agent node appears on the canvas
- attaching shows the live session output
- child agents appear as their own nodes
- messages show up in the target agent's session

## Next reading

- [Mental Model](../concepts/mental-model.md)
- [Orchestrating Child Agents](../guides/orchestrating-child-agents.md)
