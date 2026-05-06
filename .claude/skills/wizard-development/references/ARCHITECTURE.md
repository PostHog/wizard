---
title: Pipeline anatomy and data flow
description: How data moves through the wizard — from CLI args to the screen the user sees. Read when you need to understand where a new concern should hook in.
---

# Architecture

## The runner pipeline

Every wizard run — framework integration, revenue analytics, audit, generic skill — executes the same pipeline in `agent-runner.ts`. The pipeline is fixed. What varies is the `WorkflowRun` configuration object.

```
 1. Init logging + debug
 2. Health check (skip if TUI already ran it)
 3. Settings conflict detection + resolution
 4. OAuth / credential flow
 5. Skill install (if WorkflowRun.skillId is set)
 6. Agent initialization (MCP servers, tools, sandbox, env)
 7. Prompt assembly (project context + custom prompt + skill path)
 8. Agent execution (SDK query with hooks)
 9. Error classification + handling
10. Post-run hooks (WorkflowRun.postRun — e.g. env var upload)
11. Outro data construction
12. Analytics shutdown
```

### Where configuration hooks fire

- **WorkflowRun.customPrompt** — called at step 7, receives `PromptContext` (projectId, apiKey, host, skillPath). Returns additional prompt text.
- **WorkflowRun.postRun** — called at step 10, receives session + credentials. Runs after the agent succeeds but before the outro.
- **WorkflowRun.buildOutroData** — called at step 11 if present. Otherwise the runner builds default outro data from successMessage/reportFile/docsUrl.
- **WorkflowRun.abortCases** — matched against `[ABORT] <reason>` signals during step 8. First regex match renders a custom error outro.
- **WorkflowStep.onInit** — fires during store construction (step 0, before session is assigned). Use for session-independent work only (e.g. health check prefetch).
- **WorkflowStep.onReady** — fires after `tui.store.session = session` in bin.ts. Awaited in sequence. Use for session-dependent pre-flow work (e.g. framework detection, prerequisite scanning).
- **WorkflowStep.gate** — predicate checked on every `emitChange()`. bin.ts parks on `await store.getGate(stepId)` until the predicate flips true.

### What the runner does NOT know

The `agent-runner.ts` doesn't know what framework is being integrated. It doesn't know what skills exist. It doesn't know what env vars are called. It doesn't know what the outro should say. All of that comes from `WorkflowRun` and `FrameworkConfig` — configuration, not code.

## Session data flow

```
CLI args / env vars
    ↓
buildSession()          → WizardSession (flat data bag, all fields initialized)
    ↓
Store assignment        → tui.store.session = session
    ↓
onReady hooks           → detect framework, gather context, check version
    ↓
TUI screens             → user confirms setup, authenticates, etc.
    ↓                      (each screen calls a store setter → emitChange())
Agent run               → agent reads/writes files, emits signals
    ↓
postRun hooks           → env var upload, etc.
    ↓
Outro                   → session.outroData drives the outro screen
```

Session is populated in layers. Early layers provide defaults. Later layers override. Business logic reads from the session — never calls a prompt. The session never calls `getUI()`.

## Agent output flow

During the agent run (step 8), the SDK emits messages via an async generator. `handleSDKMessage` in `agent-interface.ts` processes each message:

```
SDK message (async generator)
    ↓
handleSDKMessage()
    ├─ assistant message
    │   ├─ text content → collectedText[] (for signal detection)
    │   ├─ [STATUS] marker → getUI().pushStatus() → store.statusMessages
    │   └─ TodoWrite tool_use → getUI().syncTodos() → store.tasks
    ├─ result message
    │   ├─ success → mark receivedSuccessResult
    │   └─ error → log + surface to user (unless post-success cleanup noise)
    └─ system message (init) → log tools/model/mcpServers
```

Key: the agent doesn't know the TUI exists. It uses standard Claude Code patterns (`[STATUS]` text markers, `TodoWrite` tool calls) and the harness translates them into store state. Adding a new observation channel means adding a new signal pattern to `handleSDKMessage` and a new store atom + setter, not modifying the agent prompt.

## Security boundary flow

Three layers, each enforced at a different point in the tool-use lifecycle:

```
Agent wants to use a tool
    ↓
canUseTool() [L1]           → allow/deny before execution
    ↓                          (bash allowlist, .env file fencing)
PreToolUse YARA hooks [L2]  → scan input, block if matched
    ↓                          (exfiltration, destructive ops, supply chain)
Tool executes
    ↓
PostToolUse YARA hooks [L2] → scan output, instruct revert or terminate
    ↓                          (PII in capture, hardcoded keys, prompt injection)
Result returned to agent
```

The sandbox (filesystem + network scoping) is configured once in the SDK `query()` call and enforced by the SDK runtime — not by wizard code.

Commandments (L0) are in the system prompt and operate at the model's judgment layer — no code enforcement. They're the first line, not the last.

## Screen resolution flow

```
Store setter called (e.g. store.completeSetup())
    ↓
$session atom updated
    ↓
emitChange()
    ├─ version counter bumps (React re-renders via useSyncExternalStore)
    ├─ _checkGates() — resolve any gate whose predicate is now true
    └─ _detectTransition() — fire enter-screen hooks, capture analytics
         ↓
router.resolve(session)
    ├─ if overlay stack non-empty → return top overlay
    └─ walk flow entries:
         for each entry:
           skip if entry.show(session) === false
           skip if entry.isComplete(session) === true
           return entry.screen  ← first incomplete, visible screen
         fallback: last entry (outro)
```

No imperative navigation anywhere. The router is a pure function of session state + overlay stack. If you need to change which screen is active, change the session state that the predicates read.

## The WizardUI abstraction

Business logic never imports the store directly. It calls `getUI()`, which returns a `WizardUI` interface. Two implementations:

- **InkUI** — translates calls to store setters. Used in interactive TUI mode.
- **LoggingUI** — translates calls to console output. Used in CI mode.

This boundary means the runner, the agent interface, and the OAuth flow don't know whether they're driving a TUI or printing to a log. When adding a new piece of state that the UI should reflect:

1. Add the field to `WizardSession`
2. Add a setter to `WizardStore` that calls `emitChange()`
3. Add the method to `WizardUI` interface
4. Implement in both `InkUI` (delegates to store setter) and `LoggingUI` (prints or no-ops)

## MCP server topology

The agent has access to two MCP servers:

- **posthog-wizard** — remote, HTTP-based. The PostHog MCP server at `mcp.posthog.com/mcp` (or `mcp-eu.posthog.com/mcp`). Provides query tools for PostHog data, dashboard creation, etc. Authenticated via Bearer token. Tool schemas are deferred (`ENABLE_TOOL_SEARCH: 'auto:0'`) to avoid bloating the system prompt. It's almost never the right move to add tools here, unless a server-side component is the only path forward.

- **wizard-tools** — local, in-process. Created by `createWizardToolsServer()` in `wizard-tools.ts`. Provides `check_env_keys`, `set_env_values`, `detect_package_manager`, `load_skill_menu`, `install_skill`. Runs in the wizard process — secret values never leave the machine.

Frameworks can add additional MCP servers via `FrameworkConfig.metadata.additionalMcpServers` (e.g. SvelteKit adds the official Svelte MCP at `https://mcp.svelte.dev/mcp`).

## Middleware pipeline

The middleware system is opt-in (currently used for benchmarking). It implements `{ onMessage, finalize }` — the same interface the runner expects:

```
MiddlewarePipeline
    ├─ middleware 1: onInit, onMessage, onPhaseTransition, onFinalize
    ├─ middleware 2: ...
    └─ middleware N: ...
```

Each middleware has a `name` and optional lifecycle hooks. A shared store (`MiddlewareContext.get` / `MiddlewareStore.set`) lets upstream middleware publish data that downstream middleware reads. Phase detection is automatic (from SDK message content) or explicit (`pipeline.startPhase()`).

To add a middleware: implement the `Middleware` interface, add it to the pipeline construction in `agent-runner.ts`. The pipeline dispatches in order.
