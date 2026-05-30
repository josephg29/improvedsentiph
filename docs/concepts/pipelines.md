# Pipelines

Interactive **terminals** are PTY-backed Claude Code sessions you watch on the
canvas. **Pipelines** are the complementary capability: take one task, run it
through a fixed, automatic routine — `build → check → fix → done` — and hand back
a result that has *already been inspected*, with no human babysitting the steps.

## The core principle

> Deterministic conductor, non-deterministic workers.

- **Recipes are data.** A pipeline is a declarative list of stages, not prose.
- **The conductor is pure code.** "Given the results so far, what happens next?"
  is a deterministic function with unit tests (`packages/core` —
  `application/pipelineRouting.ts`). No LLM decides control flow.
- **Only the workers are non-deterministic** — and their output is
  **schema-validated** before it can affect routing. A worker can't return mush
  and have the pipeline silently pass it.

This is what makes it a real pipeline rather than a coordinator agent improvising.

## Vocabulary

| Term | Meaning |
|---|---|
| **Run** | one execution of a pipeline over one task |
| **Stage** | one step of a recipe (`build` / `check` / `fix` / `approval`) |
| **Worker** | one headless `claude -p` process executing one stage, then exiting |
| **Recipe** | the declarative definition of a pipeline |

Terminals are interactive and watched; workers are headless and ephemeral. They
share the same substrate (the `claude` CLI + a git workspace) but run on
different code paths. A worker is "done" when its child process exits — there is
no screen-scraping.

## How a run flows

1. `POST /api/runs` creates a run and isolates it in its own git worktree.
2. The conductor (`apps/api/src/pipeline/conductor.ts`) asks the pure router for
   the next action, runs the chosen stage as one or more headless workers
   (checkers run in parallel), appends their schema-validated outcomes, and
   persists + broadcasts after every step.
3. The gate is honest: a check stage passes only if every checker returns
   `pass` with no high-severity issue. Otherwise the run routes to `fix` (bounded
   to one cycle), then re-checks. If issues remain, the run ends
   `completed_with_issues` rather than looping forever.

## Recipes and the picker

Three recipes ship in v1:

- **standard** — `build → check ×2 → fix`
- **quick** — `build → check` (no fix loop), for trivial low-risk tasks
- **careful** — `build → check ×3 → fix → human approval gate`, for risky tasks

A deterministic, keyword-driven picker (`recipePicker.ts`, never an LLM) chooses
a recipe per task when none is given: risky tasks (auth, payments, migrations,
production, secrets) earn `careful`; trivial ones (typos, renames, docs) earn
`quick`; everything else gets `standard`.

The **careful** recipe pauses at a human gate once the work verifies: the run
enters `awaiting_approval` and waits for `POST /api/runs/:id/approve` or
`/reject`. Approval passes the run; rejection completes it with issues.

## Observability and isolation

Runs are durable (one file per run under `state/runs/`), observable (`run-updated`
events over the terminal-event WebSocket; the **Pipelines** view on the web canvas),
and isolated (a per-run worktree on branch `sentiph/run-<id>`, left for you to
merge on success). See [API](../reference/api.md) and
[Filesystem Layout](../reference/filesystem-layout.md).
