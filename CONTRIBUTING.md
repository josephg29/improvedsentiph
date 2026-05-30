# Contributing

`sentiph` is an experimental personal project and is not actively reviewing pull requests right now. If you still open one, keep changes small, test-backed, and easy to review.

## Before you change anything

- read the relevant docs in `docs/`
- check whether the behavior already exists in the API or UI before adding more surface area
- keep the project Claude Code-first in docs and product framing
- do not document speculative features as if they already work

## Prerequisites

- Node.js `22+`
- pnpm
- `claude` for the supported agent workflow
- `git` for isolated worktree agents

## Setup

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

The dev runner starts the local API and web app together.

## Required checks

Run these before opening a pull request:

```bash
pnpm test
pnpm lint
pnpm build
```

Use `pnpm format` if you need to rewrite formatting.

## What good contributions look like

- incremental changes with clear scope
- tests for behavior changes
- docs updated in the same change when workflows or concepts change
- code and docs that reflect the current implementation, not a roadmap

## Docs policy

- `docs/` is for contributor and future-agent understanding
- if you change the canvas, agents, orchestration, messaging, or Activity, update the matching docs page

## Pull request expectations

- understand that pull requests are not actively reviewed right now
- explain the problem in one short paragraph
- explain the behavior change in concrete terms
- mention any persistence, API, or workflow impact
- include screenshots for visible UI changes
- disclose which coding agent and model were used if any code was written with AI
- call out missing follow-up work explicitly instead of hiding it

## Areas that matter most right now

- the live canvas and agent nodes
- Claude Code agent lifecycle
- child-agent orchestration
- inter-agent messaging
- Activity (git activity and token usage) and Settings
- fixing existing issues and optimizing for reliability
