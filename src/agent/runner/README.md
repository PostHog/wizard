# Agent runner

The runner decides how an agent run happens, then runs it. It resolves a
sequence and a harness from the caller's routing, and drives the model through
the PostHog LLM gateway.

To call it, use `runAgent`. The
[developer interfaces](../../../docs/developer-interfaces.md#runagent) cover it.

## The pieces

| Piece       | What it does                                                                     | Where                                 |
| ----------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| Entry point | `runAgent` takes a run config and input, and returns one result.                 | [`index.ts`](index.ts)                |
| Prepare     | Sets up logging, the gateway token and the scan classifier.                      | [`bootstrap.ts`](shared/bootstrap.ts) |
| Switchboard | Resolves the sequence, harness and model: CLI overrides, then flags, then the program's binding. | [`switchboard`](switchboard/index.ts) |
| Sequence    | Shapes the work: one conversation (linear), or many from a queue (orchestrator). | [`sequence`](sequence/README.md)      |
| Harness     | Adapts one SDK: the Anthropic Agent SDK or Pi.                                   | [`harness`](harness/types.ts)         |

## Execution policy

Use Pi for new work, and prefer the orchestrator. Linear is for very simple
tasks. The Anthropic Agent SDK is a legacy fallback. `DEFAULT_BINDING` is Pi and
linear.

A new model needs gateway admission as well as wizard support. See the
[development guide](../../../.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission).

## Operator refusals

The mint receives `supports_prompt_pinning: true`. When it returns a system
prompt, each model request carries that prompt with the minted bearer. SDK
queries share prompt composition and side-call settings, including the MCP
tutorial. Triage resolves the current bearer and prompt together on every call.

A pinned model reply containing `[posthog:abort]` returns an agent abort with
its reason, the text after the marker on its line. This covers turns, subagents
and YARA triage. Harnesses stop before continuation prompts, remarks or success.
Sequences report it as failure and skip post-run work. Orchestrated tasks record
a failed queue entry and publish it through existing task progress. A caller's
abort signal still means cancellation. Unpinned runs retain their existing
output handling.
