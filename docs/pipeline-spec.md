# Sentiph Pipelines — Implementation Spec (v1)

> Status: draft for build · Target: `sentiph2` (the stripped spawner + workspace base) · Author: design session, 2026-05-29

## 1. What we're building, in one paragraph

Today Sentiph spawns **interactive** Claude Code terminals you watch on a canvas. This spec adds a second, complementary capability: **pipelines** — the ability to take one task, run it through a fixed, automatic routine (**build → check → fix → done**), and hand back a result that has *already been inspected*, with no human babysitting the steps. The routine is driven by Sentiph itself, not by an agent that has to remember the steps. The work inside each step is done by Claude through its **official headless front door** (`claude -p --output-format json --json-schema …`), so we inherit Anthropic's improvements for free and never reverse-engineer or screen-scrape anything.

## 2. Goals and non-goals

**Goals (v1)**
- Run a single task through a deterministic **build → check → fix → done** pipeline.
- Each step is a **headless** Claude worker that returns a **schema-validated** result (a real "pass / needs-fix" verdict, not screen text).
- The decision logic (when to fix, when it's done) is **pure, deterministic code** — testable without spawning anything.
- Each run is **isolated** (its own git worktree), **observable** (live state), and **durable** (survives an API restart).
- Reuse the existing worktree, persistence, and routing machinery — add a thin layer, don't rebuild.

**Non-goals (v1 — deliberately deferred)**
- No automatic "smart picker" that chooses a recipe per task (one hard-coded recipe first). → M6
- No arbitrary DAG engine. v1 is linear with one conditional (fix-if-needed). 
- No multi-level "group leader" fan-out.
- No human approval gate (note where it plugs in for the future "careful" recipe).
- Interactive terminals are untouched. Pipelines are a separate path.

## 3. Core design principle (the whole point)

> **Deterministic conductor, non-deterministic workers.**

The earlier critique of the old Sentiph was that orchestration lived in an English *system prompt* — so whether work got verified depended on an LLM remembering to. We fix that at the root:

- **Recipes are data.** A pipeline is a declarative list of stages, not prose.
- **The conductor is pure code.** "Given the results so far, what happens next?" is a deterministic function with unit tests. No LLM decides control flow.
- **Only the workers are non-deterministic** — and their output is **schema-validated** before it can affect routing. A worker can't return mush and have the pipeline silently pass it.

This is what makes it a real pipeline (the right-hand "dynamic workflow" pattern) instead of "a coordinator agent improvising" (the left-hand "agent team" pattern).

## 4. Vocabulary (and how it differs from terminals)

| Term | Meaning | Lifespan | Watched? |
|---|---|---|---|
| **Terminal** (existing) | An interactive PTY-backed Claude session | Persistent | Yes, on canvas |
| **Run** (new) | One execution of a pipeline over one task | Lives until the pipeline finishes | As progress |
| **Stage** (new) | One step of a recipe (build / check / fix) | — | — |
| **Worker** (new) | One headless Claude process executing one stage | Ephemeral — spawn, do one job, exit, gone | Result only |
| **Recipe** (new) | The declarative definition of a pipeline | Static config | — |

**Terminals are interactive and watched; workers are headless and ephemeral.** They share the same substrate (the `claude` CLI + a git workspace) but run on different code paths.

## 5. Architecture

```
                         POST /api/runs  { task, recipeId }
                                   │
                                   ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  CONDUCTOR  (apps/api/src/pipeline/conductor.ts)              │
   │  • loads a Recipe (data)                                      │
   │  • walks its stages, calling the headless worker per stage    │
   │  • asks the PURE router what to do next (core)                │
   │  • persists Run state + streams updates                       │
   └───────────────┬───────────────────────────────┬──────────────┘
                   │ runs each stage as…            │ asks…
                   ▼                                ▼
   ┌───────────────────────────────┐   ┌──────────────────────────────┐
   │ HEADLESS WORKER               │   │ PURE ROUTING  (packages/core) │
   │ apps/api/src/pipeline/        │   │ application/pipelineRouting.ts│
   │   headlessWorker.ts           │   │ • nextAction(run, results)    │
   │ • builds `claude -p … --json- │   │ • gate: pass vs needs-fix     │
   │   schema …` argv              │   │ • converge: final result      │
   │ • child_process.spawn (async) │   │ • 100% deterministic + tested │
   │ • parses + schema-validates   │   └──────────────────────────────┘
   │   the JSON result             │
   │ • completion = process exit   │
   └───────────────────────────────┘

   Reused from sentiph2 today:
     • GitClient / systemClients.ts  → per-run worktree (git worktree add/remove)
     • registry.ts persistence pattern → runStore.ts (versioned, debounced)
     • createApiServer route convention → runsRoutes.ts
     • terminal event broadcast infra  → live run updates
```

### The pipeline (v1 recipe "standard")

```
   task ─▶ [ BUILD ] ─▶ [ CHECK ×2 ] ─▶  gate ──pass──▶ [ DONE ]
                            (parallel)      │
                                            └─needs-fix─▶ [ FIX ] ─▶ [ CHECK ×2 ] ─▶ DONE*
                                                                       (re-check once;
                                                                        then stop — bounded)
```

## 6. Domain model (new — `packages/core/src/domain/pipeline.ts`)

Pure types only. No `fs`, no `child_process`. Added to `packages/core/src/index.ts` exports.

```ts
export type StageRole = "build" | "check" | "fix";

export type StageId = string; // e.g. "build", "check", "fix"

export interface RecipeStage {
  id: StageId;
  role: StageRole;
  /** Appended to the worker via --append-system-prompt. The "what you are / what to report". */
  systemPrompt: string;
  model: "opus" | "sonnet" | "haiku";
  effort: "low" | "medium" | "high";
  /** How many copies run in parallel for this stage (checkers = 2). Default 1. */
  fanout?: number;
  /** Tools the worker may use. Builders/fixers: full. Checkers: read-only. */
  toolPolicy: "full" | "read-only";
  /** JSON Schema the worker MUST return. Validated before routing trusts it. */
  outputSchema: object;
}

export interface Recipe {
  id: string;            // "standard"
  title: string;
  stages: RecipeStage[]; // build, check, fix
  maxFixCycles: number;  // v1 = 1
}

export type RunStatus =
  | "pending" | "building" | "checking" | "fixing"
  | "passed" | "completed_with_issues" | "failed" | "cancelled";

export interface IssueFinding {
  severity: "low" | "medium" | "high";
  location: string;   // file:line or area
  problem: string;
  suggestion?: string;
}

export type CheckerVerdict =
  | { verdict: "pass"; issues: [] }
  | { verdict: "needs_fix"; issues: IssueFinding[] };

export interface WorkerOutcome {
  stageId: StageId;
  index: number;            // which copy (for fanout)
  ok: boolean;              // process exited 0 AND json parsed AND schema-valid
  result?: unknown;         // schema-validated payload (BuilderResult | CheckerVerdict | FixerResult)
  error?: string;           // set when ok === false
  startedAt: string;
  endedAt: string;
  costUsd?: number;         // from the claude json envelope, if present
}

export interface Run {
  runId: string;
  recipeId: string;
  task: string;             // the user's request
  status: RunStatus;
  workspaceBranch?: string; // sentiph/run-<id>, for the user to merge
  outcomes: WorkerOutcome[];// append-only log of every worker result
  createdAt: string;
  updatedAt: string;
  result?: RunResult;       // set on terminal status
}

export interface RunResult {
  status: RunStatus;
  taskSummary: string;
  filesTouched: string[];
  issuesFound: IssueFinding[];
  issuesFixed: IssueFinding[];
  issuesRemaining: IssueFinding[];
  workspaceBranch?: string;
}
```

## 7. Pure routing (new — `packages/core/src/application/pipelineRouting.ts`)

The deterministic brain. **No side effects.** Fully unit-tested. This is the file that makes the orchestration honest.

```ts
export type NextAction =
  | { kind: "run_stage"; stageId: StageId }
  | { kind: "done"; result: RunResult };

/**
 * Given the recipe and everything that has happened so far, decide the next move.
 * Deterministic. Same inputs → same output, always.
 */
export function nextAction(recipe: Recipe, run: Run): NextAction;

/** The gate: did every checker pass? (and below the severity threshold?) */
export function checkersPassed(outcomes: WorkerOutcome[], stageId: StageId): boolean;

/** Build the final RunResult from the outcome log. */
export function converge(recipe: Recipe, run: Run): RunResult;
```

Gate rule (v1): a check stage **passes** iff every checker copy returned `verdict: "pass"` with no `high`-severity issues. Any `needs_fix`, any `high` issue, or any failed checker → route to `fix` (unless we've already used `maxFixCycles`, in which case → `completed_with_issues`).

## 8. The headless worker (new — `apps/api/src/pipeline/headlessWorker.ts`)

The front door. Uses `node:child_process` `spawn` (**not** node-pty — no terminal needed for headless). Async/streaming so long runs don't block the event loop.

**Contract**

```ts
interface WorkerSpec {
  prompt: string;          // the task / stage instruction
  stage: RecipeStage;      // model, effort, systemPrompt, toolPolicy, outputSchema
  cwd: string;             // the run's worktree path
  timeoutMs: number;
  signal: AbortSignal;     // for cancellation
}

interface WorkerRun {
  ok: boolean;
  result?: unknown;        // parsed + schema-validated
  error?: string;
  costUsd?: number;
}

export function runHeadlessWorker(spec: WorkerSpec): Promise<WorkerRun>;
```

**Command it builds** (verified against `claude 2.1.158` on this machine):

```
claude -p "<prompt>"
  --append-system-prompt "<stage.systemPrompt>"
  --model <stage.model>
  --output-format json
  --json-schema '<stage.outputSchema>'
  --permission-mode <acceptEdits | plan>      # full vs read-only
  --allowedTools <Read,Grep,Glob[,Edit,Write,Bash]>
  # cwd = spec.cwd ; effort mapped to env/flag per CLI
```

**Rules**
- **Completion = the process exits.** No regex on screen text. (This retires the fragile `/esc to interrupt/` detector for pipeline work.)
- Read `stdout`, parse the single JSON envelope, pull the `result`, **validate against `stage.outputSchema`**.
- `ok = (exitCode === 0) && parsed && schemaValid`. Otherwise `ok = false` with a captured `error` — **never** pass an unparseable/invalid result downstream.
- On `timeoutMs` or `signal` abort → kill the process (SIGTERM, then SIGKILL), `ok = false`.
- Capture `costUsd`/duration from the envelope for telemetry (reuse existing usage plumbing later).

**Worker tool/permission policy**
- `build` / `fix` → `toolPolicy: "full"` → `--permission-mode acceptEdits`, full tools (edits files in the worktree).
- `check` → `toolPolicy: "read-only"` → `--permission-mode plan`, `--allowedTools Read,Grep,Glob` (inspects, never writes). This is a real safety boundary: checkers cannot mutate the work they're judging.

## 9. The conductor (new — `apps/api/src/pipeline/conductor.ts`)

Thin wiring. Holds no decision logic itself — it asks the pure router.

```
startRun(task, recipeId):
  run = newRun(); persist(run); createWorktree(run)        # isolation
  loop:
    action = nextAction(recipe, run)                        # PURE (core)
    if action.kind == "done":
        run.status = action.result.status
        run.result = action.result
        persist(run); break
    stage = recipe.stages[action.stageId]
    outcomes = await Promise.all(                           # fanout in parallel
        range(stage.fanout ?? 1).map(i =>
            runHeadlessWorker({ prompt: renderPrompt(stage, run), stage, cwd: run.worktree, … })
              .then(r => toOutcome(stage, i, r))))
    run.outcomes.push(...outcomes)
    run.status = statusForStage(stage)                      # building/checking/fixing
    persist(run); stream(run)                               # observable
  # leave the worktree + branch for the user to review/merge; cleanup on cancel/fail
```

- **Concurrency:** a shared cap (e.g. `min(8, cores-2)`) across all in-flight workers, mirroring the existing `maxConcurrentSessions` idea but in a separate pool from PTY terminals.
- **Cancellation:** `POST /api/runs/:id/cancel` aborts the `AbortSignal`, kills in-flight workers, marks `cancelled`, best-effort removes the worktree.
- `renderPrompt(stage, run)`: for `build` = the task; for `check` = "inspect the change for this task, return a verdict"; for `fix` = the task + the aggregated `needs_fix` issues from the prior check outcomes.

## 10. The v1 recipe "standard" (new — `apps/api/src/pipeline/recipes.ts`)

The genuinely-yours design. Concrete stages and schemas:

**`build` stage** — model `sonnet`, effort `medium`, tools `full`.
```json
// outputSchema
{ "type":"object","required":["summary","filesTouched","done"],
  "properties":{
    "summary":{"type":"string"},
    "filesTouched":{"type":"array","items":{"type":"string"}},
    "done":{"type":"boolean"},
    "notes":{"type":"string"} } }
```

**`check` stage** — model `sonnet`, effort `medium`, tools `read-only`, **fanout 2**.
```json
{ "type":"object","required":["verdict","issues"],
  "properties":{
    "verdict":{"enum":["pass","needs_fix"]},
    "issues":{"type":"array","items":{
      "type":"object","required":["severity","location","problem"],
      "properties":{
        "severity":{"enum":["low","medium","high"]},
        "location":{"type":"string"},
        "problem":{"type":"string"},
        "suggestion":{"type":"string"} }}} } }
```

**`fix` stage** — model `sonnet`, effort `medium`, tools `full`.
```json
{ "type":"object","required":["summary","resolved","done"],
  "properties":{
    "summary":{"type":"string"},
    "resolved":{"type":"array","items":{"type":"string"}},
    "unresolved":{"type":"array","items":{"type":"string"}},
    "done":{"type":"boolean"} } }
```

`maxFixCycles: 1`. Flow: build → check → (if needs_fix) fix → check once more → done. If still failing, status `completed_with_issues` (surface the remaining issues, never loop forever).

## 11. Workspace & isolation

- Each run gets **its own git worktree**: path `.sentiph/worktrees/run-<runId>`, branch `sentiph/run-<runId>`, created from `HEAD`.
- **Reuse `GitClient` (`systemClients.ts`) directly** — `addWorktree` / `removeWorktree` / `removeBranch`. 
- **Note / deliberate decoupling:** the existing `createWorktreeManager` is coupled to the *terminal* registry (it resolves a worktree's cwd by finding the owning terminal). Runs are not terminals, so the conductor calls `GitClient` worktree ops directly with its own `run-<id>` path/branch convention rather than going through `worktreeManager`. (Optional refactor: extract the path/branch math into a shared helper both can use.)
- All stages of one run share that one worktree (builder writes, checkers read, fixer writes). On success the branch is left for the user to review/merge (the existing git/PR ops can surface it). On cancel/fail → best-effort `removeWorktree` + `removeBranch`.

## 12. Persistence & observability

- **`apps/api/src/pipeline/runStore.ts`** mirrors `registry.ts`: a **versioned** `RunDocument`, **debounced async writes** (copy `createTerminalRegistryPersistence`), stored at `.sentiph/state/runs/<runId>.json` (one file per run; an index file lists run ids).
- On API restart: runs whose status was non-terminal (`building`/`checking`/`fixing`) are reconciled to `failed` with reason `api_restart` (mirror the existing `running → stale` terminal reconciliation). v1 does not resume in-flight runs.
- **Live updates:** reuse the existing terminal-event broadcast (WebSocket) to push `run-updated` events so the UI can render progress. Each worker start/finish appends to `run.outcomes` and emits.

## 13. HTTP API (new — `apps/api/src/createApiServer/runsRoutes.ts`)

Follows the existing route convention (parse → validate → call → `writeJson(…, corsOrigin)`), wired into `requestHandler.ts`.

| Method & path | Body / params | Returns |
|---|---|---|
| `POST /api/runs` | `{ task: string, recipeId?: "standard" }` | `{ runId }` and starts the conductor |
| `GET /api/runs` | — | `[{ runId, status, task, updatedAt }]` |
| `GET /api/runs/:id` | — | full `Run` (status, outcomes, result) |
| `POST /api/runs/:id/cancel` | — | `{ ok: true }`, aborts workers |

Reuse the existing loopback `Origin`/`Host` security checks (`security.ts`) unchanged.

## 14. Failure handling & limits (explicit, no silent passes)

- Worker non-zero exit / unparseable JSON / schema-invalid / timeout → that worker's outcome is `ok:false`; the gate treats a failed **checker** as `needs_fix` and a failed **builder/fixer** as a hard run `failed`.
- **Per-worker timeout** (config, default 10 min).
- **Bounded fix loop** — `maxFixCycles: 1` in v1. No infinite check↔fix.
- **Concurrency cap** on the headless pool.
- **Cancellation** kills in-flight workers and cleans the worktree.
- Every "ignore" path is logged (consistent with the codebase's annotated-catch style).

## 15. Testing strategy

- **`pipelineRouting` (core): exhaustive unit tests.** Feed fabricated outcome logs, assert the exact `NextAction`. This is where determinism is proven — gate thresholds, the bounded fix loop terminating, converge math. No spawning.
- **`headlessWorker` (api): tested with a fake `claude`.** Inject the binary path; point it at a stub script that emits a known JSON envelope (mirrors how the suite already fakes `node-pty` and uses `FakeGitClient`). Cover: clean result, non-zero exit, malformed JSON, schema-invalid, timeout, abort.
- **`conductor` (api): tested with an injected fake worker runner.** Dependency-inject `runHeadlessWorker` so the conductor is exercised against scripted stage results — assert full run trajectories (pass-first-try, fix-then-pass, fix-then-still-failing, builder-fails) without touching `claude`.
- **One integration test behind a flag** that runs a real `claude -p` on a trivial prompt and asserts a schema-valid result — proves the front door end to end. Skipped in CI by default (like the real-git tests).
- Keep ≥80% coverage on the new `pipeline/` + routing code.

## 16. Milestones (each independently shippable & testable)

| # | Deliverable | Proves |
|---|---|---|
| **M0** | `headlessWorker.ts` + schema validation + fake-claude tests | The front door returns clean structured results |
| **M1** | `domain/pipeline.ts` + `pipelineRouting.ts` + full unit tests | The brain is deterministic (no spawning) |
| **M2** | `conductor.ts` (build→check, no fix) + `runStore.ts` + `POST/GET /api/runs` | One task runs end-to-end, persists, is observable |
| **M3** | Gate + `fix` stage + bounded loop + parallel checkers | Real verify→fix→converge |
| **M4** | Per-run worktree isolation + branch surface + cancel + concurrency | Safe at scale, isolated, interruptible |
| **M5** | Web UI: runs on the canvas, live stream | Operator can see pipelines run |
| **M6** | Recipe registry + smart picker + "careful" recipe (human gate) | Right amount of checking, automatically |

Build M0 and M1 first and in either order — they don't depend on each other, and together they de-risk the whole thing (the front door works; the brain is provably correct) before any wiring.

## 17. File-by-file change list

**New — `packages/core` (pure, framework-agnostic):**
- `src/domain/pipeline.ts` — the types in §6
- `src/application/pipelineRouting.ts` — the pure router in §7
- add both to `src/index.ts` exports
- `tests/pipelineRouting.test.ts`

**New — `apps/api`:**
- `src/pipeline/headlessWorker.ts` — §8
- `src/pipeline/conductor.ts` — §9
- `src/pipeline/recipes.ts` — §10
- `src/pipeline/runStore.ts` — §12 (clone the `registry.ts` persistence pattern)
- `src/createApiServer/runsRoutes.ts` — §13 (+ wire into `createApiServer/requestHandler.ts`)
- `tests/headlessWorker.test.ts`, `tests/conductor.test.ts`

**Reused unchanged:** `systemClients.ts` (GitClient worktree ops), the registry persistence pattern, the route/security conventions, the WebSocket broadcast infra.

**Later — `apps/web`:** a Runs view (M5) reusing the canvas to render stages as nodes.

## 18. Open decisions for you

1. **Worktree per run, always?** Recommended yes (isolation). But trivial read-only tasks could run in the shared workspace. Default: always isolate in v1, revisit with the smart picker.
2. **What happens to a passed run's branch?** Options: (a) leave the branch for you to merge manually, (b) auto-open a PR (reuse existing `gh` ops), (c) auto-merge. Recommend (a) for v1.
3. **Effort flag mapping.** Confirm how `effort` maps onto the current `claude` CLI (env var vs flag) on the target version — a 5-minute check before M0.
4. **Re-check after fix:** v1 re-runs the full `check` stage once. Cheaper alternative: a single lighter "confirm the listed issues are resolved" check. Recommend full re-check for v1 honesty.
