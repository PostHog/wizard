# agent runner

How an agent run is assembled. Everything under this directory is plumbing — the
pieces that decide _how_ a program runs (which query shape, which agent SDK,
which model) and the pieces that then actually run it.

```
  ┌──────────────┐     ┌─────────────┐     ┌────────────────────────────┐
  │              │     │             │────▶│ sequence   (query shape)   │
  │  programs    │────▶│ switchboard │     │   linear | orchestrator    │
  │              │     │             │     └────────────────────────────┘
  │  integration │     │  binds each │
  │  audit       │     │  program to │     ┌────────────────────────────┐
  │  migration   │     │  a pair     │────▶│ harness    (SDK adapter)   │
  │  ...         │     │             │     │   anthropic | pi | ...     │
  └──────────────┘     └─────────────┘     └────────────────────────────┘
```

## Execution policy

Use Pi for new work and prefer the orchestrator sequence. Linear execution is
retained for very simple tasks and legacy support. The Anthropic Agent SDK is a
supported legacy fallback, deprecated as the default, retained for major Pi
vulnerabilities or gaps in support for new Anthropic models.

Existing `DEFAULT_BINDING` remains Anthropic + linear; explicit program bindings
and flags determine actual behavior. Both harnesses implement `run` and
`runTask`. Composed sub-runs are clamped to linear, and linear-only
post-run/outro hooks do not automatically transfer to an orchestrated flow.

New models require Wizard capabilities **and** mint model/effort allowlists,
gateway provider/transport support, and compatibility with required Wizard and
security-triage prompt policies. Local model constants cannot bypass admission.
See the
[development guide](../../../../.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission)
for the coordinated change checklist.

## The pieces

Five layers, each with its own job. Nothing crosses layers unless it has to.

**The entry point** (`index.ts`) is the front door:
`runAgent(config, input, {onProgress?, interaction?}) → RunResult`. It takes
resolved execution data and an invocation snapshot (`shared/types.ts`), reports
through `onProgress` and asks through `interaction` (`../progress.ts`), and
returns every ending as a result. It never renders, reads a session or exits.
The gates, OAuth, flags and binding lookup that used to run here live in
`src/lib/programs/run-agent-legacy.ts`, which also maps progress back onto
`getUI()` for today's runners.

**Prepare** (`shared/bootstrap.ts`) is the on-ramp inside the agent: logging
targets, the gateway mint and the scan-triage classifier. Whether the run turns
out to be linear or orchestrator, anthropic or pi, the setup is the same.

**The switchboard** (`switchboard/`) is the router. Given a program id + the
fetched flags + any CLI overrides, it returns a `ProgramBinding` — which query
shape (sequence), which agent SDK (harness), which model. Two independent
middleware chains, one per axis, apply precedence rules (CLI > flag > program
config > default). This is the only layer that makes routing decisions.

**Sequences** (`sequence/`) are LLM query shapes. Once the switchboard has
picked one, that sequence takes over the run and owns _how the LLM's work is
shaped_. See `sequence/README.md`.

- **linear** — one long conversation with the model, start to finish.
- **orchestrator** — many focused conversations coordinated by a task queue,
  each with its own prompt, tools, and model.

**Harnesses** (`harness/`) are SDK adapters. Sequences don't call Anthropic's or
pi.dev's SDKs directly — they go through a harness, which knows how to translate
a run request into that SDK's shape. All harnesses drive the PostHog LLM
gateway.

- **anthropic** — wraps Anthropic's official Claude Agent SDK. See
  `harness/anthropic/README.md`.
- **pi** — wraps pi.dev's coding-agent library. See `harness/pi/README.md`.

## How they connect

- Prepare mints the gateway token and builds triage for the resolved harness.
- The switchboard knows which sequences and harnesses exist (via its two
  registries), but not what they do.
- A sequence knows how to shape a conversation, but delegates the actual model
  call to a harness.
- A harness adapts its SDK, gateway transport, security hooks, and tool surface.

Each layer is replaceable.

## Flow

1. The caller runs its gates, authenticates, fetches PostHog flags and resolves
   a `ProgramBinding { sequence, harness, model }`; analytics tags the run.
2. `runAgent(config, input, options)` prepares (mint, triage).
3. Sequence takes over — shapes the LLM's work into one conversation (linear) or
   many (orchestrator), reporting through `onProgress`.
4. Harness drives each conversation through its SDK, using the bound model, on
   the PostHog LLM gateway.
5. The scan report flushes; `runAgent` returns a `RunResult`.
6. The caller applies it: a decided failure goes to `wizardAbort`, a crash is
   rethrown for the runner's own handling.
