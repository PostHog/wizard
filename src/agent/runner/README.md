# Agent runner

The runner decides how an agent run happens, then runs it. It resolves a
sequence and a harness from the caller's routing, and drives the model through
the PostHog LLM gateway.

To call it, use `runAgent`. The
[developer interfaces](../../../docs/developer-interfaces.md#runagent) cover it.

## The pieces

| Piece       | What it does                                                                                     | Where                                 |
| ----------- | ------------------------------------------------------------------------------------------------ | ------------------------------------- |
| Entry point | `runAgent` takes a run config and input, and returns one result.                                 | [`index.ts`](index.ts)                |
| Prepare     | Sets up logging, the gateway token and the scan classifier.                                      | [`bootstrap.ts`](shared/bootstrap.ts) |
| Switchboard | Resolves the sequence, harness and model: CLI overrides, then flags, then the program's binding. | [`switchboard`](switchboard/index.ts) |
| Sequence    | Shapes the work: one conversation (linear), or many from a queue (orchestrator).                 | [`sequence`](sequence/README.md)      |
| Harness     | Adapts one SDK: the Anthropic Agent SDK or Pi.                                                   | [`harness`](harness/types.ts)         |

## Execution policy

Use Pi for new work, and prefer the orchestrator. Linear is for very simple
tasks. The Anthropic Agent SDK is a legacy fallback. `DEFAULT_BINDING` is Pi and
linear.

A new model needs gateway admission as well as wizard support. See the
[development guide](../../../.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission).

## Operator refusals

When the gateway token mint returns a `system_prompt`, every model call sends
it: pi as its own system unit, the Claude SDK harness as the last text of the
`claude_code` preset prompt. A model reply in a turn, subagent or YARA triage
call that contains `[posthog:abort]` ends the run as a failure, with the rest of
that line as the reason. The MCP tutorial stream sends the prompt but does not
check for the marker.
