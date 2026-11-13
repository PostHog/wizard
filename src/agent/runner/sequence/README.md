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

[orchestrator-runner.ts](orchestrator/orchestrator-runner.ts) loads a flow's
prompts, queues its tasks, then drains a dependency-aware task queue. Each task
gets a focused conversation, tools, selected model/effort, and relevant
handoffs. Independent tasks can run concurrently.

With `wizard-agent-dag` on, the prompts are the ones the program bundles, the
run config's `agentPrompts`; see
[agent prompts](../../../programs/README.md#agent-prompts). Off, or for a
program that bundles none, the orchestrator fetches the flow `agentFlow ?? id`
from context-mill. A bundle that fails to load is reported as an exception with
the step `orchestrator_bundled_prompts`, and the run fetches instead. Every
event sent after the prompts load carries which as the `orchestrator_prompts`
tag. That tag says which path a run took, and the flag's value on an event does
not: a pinned run reports the flag as on and still fetches.

A flow's seed planner queues its tasks. A bundled flow with no seed prompt is
queued from the graph its frontmatter declares, by
[task-graph.ts](orchestrator/task-graph.ts), and no planner runs. A fetched flow
with no seed prompt fails the run with `PHW_AGENT_ORCHESTRATOR_NO_PLANNER`.
`orchestrator seeded` carries which one queued the run as `source`. A declared
graph that cannot be queued ends the run with
`PHW_AGENT_ORCHESTRATOR_TASK_GRAPH` and sends `orchestrator task graph
rejected` with the reason.

A flow must supply valid task-skill variants, and a seed prompt unless it is
bundled without one. Metrics already has a Pi/orchestrator binding; other routes
can be selected through scoped flags or development CLI overrides. The retired
`experiment/orchestrator` branch is not a prerequisite. See
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

With `wizard-agent-dag-skills` on, a task reads the skill that stands in for the
one its prompt names: the menu entry whose `replaces` is that name. An entry
with `frameworkReferences` is one skill written for every framework, and the
runner installs it into an emptied folder, so a page an earlier run left
there does not replace the pack's, completes it from the framework's reference
skill with `@shared/skill-composition`, then scans the completed skill, since
completing it writes text the install scan never read. When a replacement fails to
install, the reference skill cannot complete it, or the scan rejects it or
fails, the task reads the skill its prompt names and the run sends
`orchestrator repackaged skill unavailable` with the reason. A completed skill
the scan did not pass is deleted.
Every event sent after the menu loads carries which a run read as the
`orchestrator_skills` tag: `repackaged` when the flag is on and the menu has a
replacement, `bundles` otherwise. The flag is independent of `wizard-agent-dag`.

`pnpm verify:repackaged-skills [dist-or-url]` checks a context-mill build or
release: for every framework and every replaced skill, the files a task reads
are the same both ways.

A run pinned to a context-mill release with `--context-mill-version` takes none
of the `wizard-agent-dag` paths, and reads no repackaged skill.

Before the tasks run, the runner installs the framework's `integration` skill as
a reference: its example and its framework rules go into every task's prompt.
When that install fails, the run goes on without them and sends
`orchestrator reference skill unavailable` with the reason.

A task skill the menu cannot supply fails the run before any task starts. When
the prompts are bundled and the loaded menu has that name under no id and no
family, the wizard is older than the skills, and the message says to run the
latest version. Any other miss keeps the message that asks to try again.

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
- `dependsOn` names the task types a task runs after. In a flow with a planner,
  the planner supplies actual task IDs to `enqueue_task`, and only runner-seeded
  tasks resolve their declared types, after planning. In a flow queued from its
  frontmatter, the declared types are the graph: each task is queued after the
  ones it names, a task the run excludes hands its dependencies to the tasks
  that waited on it, and the `sink` task also waits for every task its
  dependencies do not reach. A name the flow does not declare is dropped and
  logged.

Per-role `contextMillOverride` on the program's `binding` can adjust a task's
harness, model or effort. New task types usually belong in context-mill; new
native behavior still requires the appropriate Wizard configuration or
implementation.
