# Switchboard

The switchboard decides how one agent run happens. It picks four things:

| Axis     | Values                                       | Decided           |
| -------- | -------------------------------------------- | ----------------- |
| Sequence | `linear` or `orchestrator`                   | Once per run      |
| Harness  | `pi` or `anthropic`                          | Per run and role  |
| Model    | A gateway model ID, such as `openai/gpt-5.6-sol` | Per run and task |
| Effort   | `minimal`, `low`, `medium`, `high` or `xhigh` | Per run and task |

A role is `default` in a linear run. In an orchestrator run it is `seed` for the
planner, or the task's type for each task.

[`resolve-run.ts`](resolve-run.ts) turns a caller's routing into the resolved
binding. [`sequence.ts`](sequence.ts) and [`harness.ts`](harness.ts) each run a
middleware chain. The first rung that has an answer wins. The program's binding
is the base when no rung answers.

## Who decides

From strongest to weakest:

| Rung | Who sets it | How |
| --- | --- | --- |
| 1. Dev CLI flags | A developer | `--sequence`, `--harness` and `--model`. Non-production builds only. Published builds drop these rungs. |
| 2. PostHog feature flags | An experiment | A flag routes the programs its experiment declares. See [flag experiments](#flag-experiments). |
| 3. Task frontmatter | A [context-mill](https://github.com/PostHog/context-mill) task prompt | `model_pi` and `effort_pi` for Pi. `model_sdk` and `effort_sdk` for Anthropic. Orchestrator runs only. |
| 4. `ProgramBinding` | The program | `binding` on its config: `sequence`, `harness`, `model`, `thinkingLevel`, and `contextMillOverride` per role. Without one, the program runs on `DEFAULT_BINDING`, Pi and linear. |

The sequence, the harness, and the model and effort of a linear run use rungs
1, 2 and 4, in that order. Frontmatter only sets the model and effort of an
orchestrator task, in this order:

1. A `model` the seed set when it queued the task (`enqueue_task`).
2. The stage override payload of `wizard-orchestrator-override`, for the stages
   it names.
3. The task's frontmatter for the resolved harness.
4. The model from the chain above: CLI `--model`, then a flag route, then the
   binding.

So in an orchestrator run, frontmatter beats `--model` and the harness flags.
Only the seed's pick and the stage override payload beat frontmatter. Task effort comes from steps
2 and 3 only. Without either, the model's default effort applies.

Two rules sit outside the table:

- **Composed runs are linear.** A program run inside another program, such as
  the integration inside self-driving, is always linear. This beats every rung,
  CLI included.
- **No `runTask`, no orchestrator.** A harness that does not implement
  `runTask` runs linear. Both harnesses implement it today.

## Flag experiments

Each experiment lives in [`flags`](flags/index.ts) and names the programs it
routes. A flag does nothing for any other program.

| Flag | Programs | What it sets |
| --- | --- | --- |
| `wizard-orchestrator` | `posthog-integration` | Orchestrator sequence on Pi. Models come from frontmatter. |
| `wizard-orchestrator-override` | `posthog-integration` | A variant payload `{ "<stage>": { "model"?, "effort"? } }` that beats frontmatter for those stages. Local runs only. |
| `wizard-self-driving-use-pi-harness` | `self-driving` | A payload `{ "model", "effort"?, "harness"?, "sequence"? }`. |

A payload names models by flag key: `gpt-5-6-luna`, `gpt-5-6-terra`,
`gpt-5-6-sol` or `sonnet-5`. A missing or invalid payload changes nothing, and
the run log says why.

## Trace

Every run records which rung decided each axis.

- **Event.** `switchboard resolved` carries the inputs, the pick, and
  `harness_source`, `model_source` and `sequence_source`. A source is `cli`,
  `flag` or `binding`. The sequence can also say `composed`, `runtask-clamp` or
  `payload`. An orchestrator run with no pinned model reports its model as
  `chosen-per-task`, from `agent-prompts`.
- **Event.** `orchestrator task models` maps each task type to the model it
  will run on.
- **Log.** `[switchboard] resolved:` and `[switchboard] decision:` lines in the
  run log, and `[orchestrator] task models:`.

## Add a model

Adding a model needs a change on the PostHog side too. Ask the Wizard & Docs
team.
