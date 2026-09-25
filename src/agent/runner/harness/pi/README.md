# Pi harness

The default harness for new Wizard work, built on
`@earendil-works/pi-coding-agent`. Prefer orchestrated flows; linear execution
remains useful for very simple tasks and legacy support. Existing program
bindings can still select the Anthropic SDK. See
[runner policy](../../README.md#execution-policy).

## Entry points and transport

- [index.ts](index.ts): `run()` drives a linear conversation.
- [task.ts](task.ts): `runTask()` drives a seed or task conversation for
  orchestration.
- [gateway.ts](gateway.ts): shared scoped-token transport and model
  registration.

Model IDs with the `openai/` prefix use the Responses transport; Anthropic IDs
use the Messages transport. Both use the minted gateway token, not the user's
OAuth token directly. The gateway must admit the model and effort and support
its required Wizard or security-triage prompt shape. A model registry entry
alone cannot grant access.

A turn that ends on a 401 from an aged gateway token re-mints once, then
continues. Pi's own auto-retry stays on and covers `socket hang up` and
`terminated`. Its fixed error pattern misses the gateway's mid-stream
`upstream closed the stream` frame and `ECONNRESET`, so on those the wizard
drops the cut-off turn and continues after about 1s, then 2s, with ±20% jitter,
at most twice per prompt. Both resume the conversation with a continue prompt
and never re-send the task. Each stream retry is logged and captured as
`model stream retried`. A drop that outlasts the retries fails the run with a
message that points at the network or the gateway.

## Tools and security

Pi sessions explicitly install tools and disable project-controlled extensions,
skills, context files, prompt templates, and themes. Shell subprocesses receive
a scrubbed environment. [security.ts](security.ts) adapts shared Wizard tool
permissions and warlock scanning to Pi's `tool_call` and `tool_result` events.
It distinguishes a blocked call from a latched critical violation that ends
work.

The linear path supplies file/exploration tools, shell, Wizard capabilities,
todos and bounded subagents. The orchestrator task path supplies its task and
handoff capabilities; it is not an identical tool roster. Inspect the entrypoint
and [tools](tools.ts) when extending either. [subagent.ts](subagent.ts) applies
the parent's security factory to bounded read-only exploration agents.

[commandments.ts](../../switchboard/commandments.ts) assembles runtime/tool
guidance alongside flow/task context. The linear path also supplies MCP server
instructions when available. This local guidance is separate from the required
safety policy owned by the gateway.

## Completion limits

There is no general Pi assistant-turn cutoff. Linear execution can issue up to
20 continuation nudges when work remains; task execution can issue up to 3. The
security extension blocks tool calls beyond `MAX_TOOL_CALLS` (250); that counter
is distinct from assistant turns and continuation nudges. Preserve these
distinctions when diagnosing a run or reporting snapshot results.
