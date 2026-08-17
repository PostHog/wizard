# agent runner

How an agent run is assembled. Everything under this directory is plumbing — the pieces that decide *how* a program runs (which query shape, which agent SDK, which model) and the pieces that then actually run it.

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

## The pieces

Five layers, each with its own job. Nothing crosses layers unless it has to.

**The entry point** (`index.ts`) is the front door. It receives a program config and a session, and orchestrates the run at the highest level.

**Bootstrap** (`shared/bootstrap.ts`) is the on-ramp. Every run starts with the same setup work — health checks, settings conflicts, OAuth, PostHog feature flag fetch, MCP URL, AI opt-in gate. Whether the run turns out to be linear or orchestrator, anthropic or pi, the setup is the same.

**The switchboard** (`switchboard/`) is the router. Given a program id + the fetched flags + any CLI overrides, it returns a `ProgramBinding` — which query shape (sequence), which agent SDK (harness), which model. Two independent middleware chains, one per axis, apply precedence rules (CLI > flag > program config > default). This is the only layer that makes routing decisions.

**Sequences** (`sequence/`) are LLM query shapes. Once the switchboard has picked one, that sequence takes over the run and owns *how the LLM's work is shaped*. See `sequence/README.md`.

  - **linear** — one long conversation with the model, start to finish.
  - **orchestrator** — many focused conversations coordinated by a task queue, each with its own prompt, tools, and model.

**Harnesses** (`harness/`) are SDK adapters. Sequences don't call Anthropic's or pi.dev's SDKs directly — they go through a harness, which knows how to translate a run request into that SDK's shape. All harnesses drive the PostHog LLM gateway.

  - **anthropic** — wraps Anthropic's official Claude Agent SDK. See `harness/anthropic/README.md`.
  - **pi** — wraps pi.dev's coding-agent library. See `harness/pi/README.md`.

## How they connect

- Bootstrap knows nothing about the switchboard, sequences, or harnesses.
- The switchboard knows which sequences and harnesses exist (via its two registries), but not what they do.
- A sequence knows how to shape a conversation, but delegates the actual model call to a harness.
- A harness knows its SDK. Nothing else.

Each layer is replaceable.

## Flow

1. Program picked → session built.
2. Bootstrap runs (shared setup, fetches PostHog flags).
3. Switchboard resolves a `ProgramBinding { sequence, harness, model }`.
4. Analytics tags the run with its bindings.
5. Sequence takes over — shapes the LLM's work into one conversation (linear) or many (orchestrator).
6. Harness drives each conversation through its SDK, using the bound model, on the PostHog LLM gateway.
7. Cleanup runs (scan report, settings restore, outro).
