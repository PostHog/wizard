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

`AgentRunDefinition.customPrompt`, `abortCases`, and the program's `postRun` and
`buildOutroData` hooks are linear hooks. The orchestrator does not invoke them.
Composed program sub-runs are also clamped to linear because an orchestrator
owns its full lifecycle and cannot nest through the composition seam.

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
[adding a program](../../../../.claude/skills/adding-skill-program/SKILL.md).

A task prompt names its skills by menu id or by skill family, and the runner
resolves each name to the menu skill to install. With `wizard-agent-dag` on,
`@shared/skill-resolution` picks the family's skill for the run's match keys;
off, the runner's own menu lookup does. The match keys are the run config's
`matchKeys`, which the program runner fills from the project's traits, with the
run's framework as the `framework` key. Both pick the same skill for every
family, menu id and framework on the recorded menu, which
[skill-equivalence.test.ts](orchestrator/__tests__/skill-equivalence.test.ts)
checks.

A run pinned to a context-mill release with `--context-mill-version` takes none
of the `wizard-agent-dag` paths.

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
- `timeoutSeconds` optionally limits a queued task's wall-clock time, including
  harness setup and agent work. It is a positive integer up to 86400, and an
  invalid value is logged and ignored. The runner cancels through the harness
  signal, waits for cleanup, and never retries the task. A task that already
  reported stays as it reported, and a security stop stays fatal. Tasks without
  this field retain their existing lifetime. In a task with a budget, each Pi
  bash command stops about a minute before the deadline, so the agent can still
  write its handoff. A Pi bash command that sets no timeout stops after five
  minutes in any task.
- `onTimeout` sets what a required task with a budget does at its deadline.
  `continue` completes it with a `conflict` saying what is unverified, so
  dependents run and the outro reports it; this is also the fallback for a
  missing or invalid value. `fail` stops the run. An optional task always fails
  once and unblocks its dependents. Every deadline captures
  `orchestrator task deadline exceeded` with its landing, because a `continue`
  task also counts as completed.
- `dependsOn` has different consumers: planner-enqueued tasks use actual task
  IDs supplied to `enqueue_task`, while runner-seeded tasks resolve declared
  task types after planning. It is not a universal automatic graph built from
  frontmatter.

Per-role `contextMillOverride` on the program's `binding` can adjust a task's
harness, model or effort. New task types usually belong in context-mill; new
native behavior still requires the appropriate Wizard configuration or
implementation.
