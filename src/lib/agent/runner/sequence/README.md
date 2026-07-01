# sequence

Two ways to shape an LLM conversation. Both call the same harnesses; they
differ in how the work is broken up and how the model's context is managed.

```
sequence/
├── linear.ts           ← one uninterrupted conversation
└── orchestrator/       ← many focused conversations coordinated by a queue
```

## linear

One conversation with the model, start to finish. The wizard hands it a
prompt that includes the framework instructions and the project context,
then lets it work until it says it's done.

```
[install skill] → prompt → conversation → outro
```

The model has one set of tools and one model choice for the whole run.
Everything it's ever seen this run stays in its context window. Good when
the job is coherent enough to be reasoned about as one thread — most
integrations fit here today.

## orchestrator

Many short conversations instead of one long one. A **seed** conversation
plans the work and hands out a to-do list; then each item on the list runs
as its own separate conversation, each with a fresh context window, its
own tool permissions, and its own model.

```
seed conversation → to-do list → drain loop → per-task conversation → next item
                                    ▲                                    │
                                    └──── may add more items ────────────┘
```

This lets you shape LLM work in ways a single conversation can't:

- **Different tools per step.** A "read the codebase" step can be given only
  `Read`/`Grep`; a "create the dashboard" step can be given only the
  dashboard API tools. Errors and misuse get contained per step.
- **Different models per step.** Use a cheap model for mechanical planning
  and an expensive model for tricky code changes — or vice versa.
- **Parallelism.** Independent steps run at the same time. If "create
  dashboard" and "generate report" both only depend on "build", they run
  concurrently.
- **Explicit dependencies.** Each step declares what has to finish before
  it can start. The wizard runs the graph; the model doesn't have to keep
  the order in its head.
- **Handoffs, not shared context.** Each step ends by writing a short
  structured summary (what it did, what's next to know). The next step reads
  only what's relevant, keeping context windows small and focused.

### Anatomy of one step

Each step is one markdown file whose frontmatter declares its shape:

```yaml
---
type: dashboard
flow: posthog-integration
label: Create a starter dashboard
model: claude-sonnet-4-6
skills: [basic-integration-dashboard]
allowedTools: [Read, Glob, Grep]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [build]
---
```

| Field | Means |
|---|---|
| `type` | The step's name — used when other steps declare it as a dependency. |
| `flow` | Which program this step belongs to (integration, audit, migration, …). |
| `label` | Shown in the TUI todo list while the step runs. |
| `model` | Which LLM handles this specific step. |
| `skills` | Extra instructions installed for this step only. |
| `allowedTools` / `disallowedTools` | Exactly what tools this step's conversation can use. Everything else is blocked. |
| `dependsOn` | Which steps have to finish before this one can start. |

### An example plan

For a full integration, the seed produces something like:

```
                       seed (plan the integration)
                                 │
             ┌──── enqueues ─────┼──── enqueues ────┐
             ▼                   ▼                  ▼
           init ──▶ install ──▶ identify ──┐
                                ├─▶ capture ┼─▶ build ─┬─▶ dashboard
                                └─▶ err-trk ┘          └─▶ report
```

`build` waits for the three data-capture steps; `dashboard` and `report`
fan out from `build` and run in parallel.

### Notes

- All the step definitions live in **context-mill** (as markdown). Adding a
  new step type is a content change over there — no wizard release needed.
- Per-step overrides via `PROGRAM_BINDINGS[id].contextMillOverride` let the
  wizard route a specific step to a different model or harness without
  touching the step's markdown.
- Gated by the `wizard-orchestrator` PostHog flag or forced via
  `--sequence=orchestrator`. Requires context-mill to be publishing its
  agent manifest — today only on the `experiment/orchestrator` branch.
