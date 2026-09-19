# Sequences

Sequences shape agent work; harnesses adapt the SDK that executes each
conversation. Use Pi for new work and prefer orchestration. See
[runner policy](../README.md#execution-policy) for legacy support and model
admission requirements.

## Linear

[linear.ts](linear.ts) runs one conversation, including skill installation,
prompt assembly, error routing, post-run work, and outro construction. Retain it
for very simple tasks and legacy support. Its context is subject to the
harness's compaction behavior.

`ProgramRun.customPrompt`, `abortCases`, `postRun`, and `buildOutroData` are
linear hooks. The orchestrator does not invoke them. Composed program sub-runs
are also clamped to linear because an orchestrator owns its full lifecycle and
cannot nest through the composition seam.

## Orchestrator

[orchestrator-runner.ts](orchestrator/orchestrator-runner.ts) loads a flow from
context-mill, runs its seed planner, then drains a dependency-aware task queue.
Each task gets a focused conversation, tools, selected model/effort, and
relevant handoffs. Independent tasks can run concurrently.

The program selects `agentFlow ?? id`. Its published flow must supply a seed
prompt and valid task-skill variants. Metrics already has a Pi/orchestrator
binding; other routes can be selected through scoped flags or development CLI
overrides. The retired `experiment/orchestrator` branch is not a prerequisite.
See
[adding a program](../../../../../.claude/skills/adding-skill-program/SKILL.md).

### Task metadata

Read [AgentPrompt and its parser](../../agent-prompt-loader.ts) for the current
frontmatter contract rather than copying an old manifest example:

- `type`, `flow`, and `label` identify the task and its UI label.
- `seed`, `sink`, and `runnerSeeded` distinguish planning, final reporting, and
  tasks placed by the runner.
- `model_pi`/`effort_pi` select the Pi profile; `model_sdk`/`effort_sdk` select
  the legacy SDK profile. Both must satisfy gateway model/effort admission and
  required prompt compatibility.
- `skills`, `allowedTools`, and `disallowedTools` shape the task's capabilities.
  Inspect the selected harness's effective tool inventory.
- `dependsOn` has different consumers: planner-enqueued tasks use actual task
  IDs supplied to `enqueue_task`, while runner-seeded tasks resolve declared
  task types after planning. It is not a universal automatic graph built from
  frontmatter.

Per-role `PROGRAM_BINDINGS[id].contextMillOverride` can adjust a task's harness,
model or effort. New task types usually belong in context-mill; new native
behavior still requires the appropriate Wizard configuration or implementation.
