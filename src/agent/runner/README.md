# Agent runner

> ⚠️ **The bindings table will be gone.** The switchboard still holds the
> program bindings table. By the end of this refactor it moves to programs, and
> the runner takes a resolved route only.

The runner decides how an agent run happens, then runs it. It picks a sequence
and a harness for the program, and drives the model through the PostHog LLM
gateway.

To call it, use `runAgent`. The
[developer interfaces](../../../docs/developer-interfaces.md#runagent) cover it.

## The pieces

| Piece       | What it does                                                                     | Where                                 |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| Entry point | `runAgent` takes a run config and input, and returns one result.                 | [`index.ts`](index.ts)                |
| Prepare     | Sets up logging, the gateway token and the scan classifier.                      | [`bootstrap.ts`](shared/bootstrap.ts) |
| Switchboard | Picks the sequence, harness and model for a program.                             | [`switchboard`](switchboard/index.ts) |
| Sequence    | Shapes the work: one conversation (linear), or many from a queue (orchestrator). | [`sequence`](sequence/README.md)      |
| Harness     | Adapts one SDK: the Anthropic Agent SDK or Pi.                                   | [`harness`](harness/types.ts)         |

## Execution policy

Use Pi for new work, and prefer the orchestrator. Linear is for very simple
tasks. The Anthropic Agent SDK is a legacy fallback. `DEFAULT_BINDING` is Pi and
linear.

A new model needs gateway admission as well as wizard support. See the
[development guide](../../../.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission).
