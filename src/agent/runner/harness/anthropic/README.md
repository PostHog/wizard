# Anthropic Agent SDK harness

**Deprecated and unused.** No program binds this harness and no run falls back
to it. The code is retained for a major Pi vulnerability or missing support for
a new Anthropic model, and a development build reaches it with
`--harness anthropic`. Use Pi and prefer orchestration; see
[runner policy](../../README.md#execution-policy).

[index.ts](index.ts) wraps the Claude Agent SDK through
[agent-interface.ts](../../../agent-interface.ts). Both entry points are
supported: `run()` for linear conversations and `runTask()` for orchestrator
seed/task calls. Pi also implements both entry points.

The SDK subprocess uses the scoped token minted by
[gateway-session.ts](../../../gateway-session.ts). Wizard explicitly sets the
gateway URL and authentication environment and isolates stored Claude logins.
Model selection must satisfy local routing, the SDK's supported transport, mint
model/effort allowlists, and the gateway's required prompt policy. The SDK is
not an arbitrary-provider transport just because model IDs are strings.

Security is enforced through `wizardCanUseTool`, SDK sandbox configuration, and
warlock pre/post tool hooks. Sensitive question answers use vault references;
write operations are also guarded while a question overlay is open. Read
[agent-interface.ts](../../../agent-interface.ts),
[yara-hooks.ts](../../../yara-hooks.ts), and
[wizard-tools](../../../tools/) for current tool registration and
permission behavior rather than maintaining a second tool inventory here.
