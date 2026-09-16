---
title: Runner architecture and data flow
description:
  Source map for routing, lifecycle, security boundaries, and screen resolution.
---

# Architecture

## Runner and lifecycle

[run-wizard.ts](../../../../src/lib/runners/run-wizard.ts) owns the program's
interactive lifecycle: create the session and TUI, assign the session, run
readiness hooks, and traverse steps and gates.
[store.ts](../../../../src/ui/tui/store.ts) runs `onInit` when the TUI starts;
`onReady` runs after the real session is assigned. Keep session-dependent
detection in `onReady`. Noninteractive execution has its own lifecycle in
[run-non-interactive.ts](../../../../src/lib/runners/run-non-interactive.ts).

[runner/index.ts](../../../../src/lib/agent/runner/index.ts) resolves a
program's `run` definition, calls shared bootstrap, selects a binding,
dispatches the sequence, and flushes the scanner report on cleanup. The old
[agent-runner.ts](../../../../src/lib/agent/agent-runner.ts) is a compatibility
export.

| Layer           | Source and responsibility                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bootstrap       | [shared/bootstrap.ts](../../../../src/lib/agent/runner/shared/bootstrap.ts): shared health/settings/auth/flag and MCP setup                                                    |
| Switchboard     | [switchboard/index.ts](../../../../src/lib/agent/runner/switchboard/index.ts): resolve sequence, harness, model and effort override                                            |
| Linear sequence | [sequence/linear.ts](../../../../src/lib/agent/runner/sequence/linear.ts): one conversation, skill/prompt assembly, post-run hooks and outro                                   |
| Orchestrator    | [orchestrator-runner.ts](../../../../src/lib/agent/runner/sequence/orchestrator/orchestrator-runner.ts): seed plan, task queue, focused conversations, handoffs and completion |
| Harness         | [harness/types.ts](../../../../src/lib/agent/runner/harness/types.ts): SDK boundary, implemented by Pi and Anthropic                                                           |

The contribution policy is
[Pi by default, orchestration preferred](../SKILL.md#execution-policy-and-model-admission).
Linear remains useful for very simple tasks and legacy support. Existing
bindings and composed sub-runs still use it; the Anthropic SDK remains a
supported legacy fallback. These are separate choices: sequence describes the
work shape, harness selects the SDK, and the model selects a gateway/provider
route.

### Configuration hooks

Read [ProgramRun](../../../../src/lib/agent/runner/shared/types.ts) for exact
signatures.

| Surface                                | Current consumer                                               |
| -------------------------------------- | -------------------------------------------------------------- |
| `customPrompt`, `abortCases`           | Linear prompt assembly and abort handling                      |
| `postRun(session, credentials)`        | Linear success path, before outro                              |
| `buildOutroData(session, credentials)` | Linear custom outro; otherwise defaults from run metadata      |
| `agentFlow` and task skill variants    | Orchestrator flow selection and task execution                 |
| `ProgramStep.run`                      | Explicit program composition in the outer lifecycle            |
| `ProgramConfig.requires`               | Dependency metadata; it does not execute prerequisite programs |

Do not migrate a linear program merely by changing its binding if it depends on
these hooks. Inspect the orchestrator's flow and completion path instead.
[Metrics](../../../../src/lib/programs/metrics/) is a current Pi/orchestrator
example. Native command modules still need registration in
[bin.ts](../../../../bin.ts); screen sequences derive from the program registry.

## Switchboard contract

`resolveBinding(ctx, role?)` is the routing seam. Read its exported types rather
than copying their fields into another document. It receives the program, flag
snapshot/payloads, composition state, and development overrides, returning the
binding and stamping a trace of the selected precedence rungs.

- Harness/model: development CLI override, declared flag route, per-program
  binding, default.
- Sequence: composed linear clamp, development CLI override, `runTask`
  capability clamp, program flag route, sequence experiment, binding/default.

[Harness](../../../../src/lib/agent/runner/switchboard/harness.ts) and
[sequence](../../../../src/lib/agent/runner/switchboard/sequence.ts) contain the
exact chains. Published builds omit CLI overrides. `RUN_SURFACE` can disable
harness experiments; static bindings and harness capabilities also affect
resolution. Composed sub-runs remain linear even when a CLI override requests
orchestration.

Effort resolves in two stages: the binding supplies an override, then
[modelCapabilities](../../../../src/lib/agent/runner/switchboard/models.ts)
applies capabilities and defaults. All selected models and efforts must also be
admitted by the minted token and gateway. Local routing cannot bypass that
external policy; see the
[model admission checklist](../SKILL.md#execution-policy-and-model-admission).

Flags belong in
[switchboard/flags](../../../../src/lib/agent/runner/switchboard/flags/).
Experiments declare their program scope; malformed payloads yield no experiment
route. Reuse the
[switchboard tests](../../../../src/lib/agent/runner/__tests__/switchboard.test.ts)
and experiment tests to check full bindings and isolation of unrelated programs.
Do not add a second flag-reading path inside a harness or sequence.

## Security boundaries

The gateway admits scoped tokens, models, efforts, and required prompt policy.
Wizard's local tool boundary separately restricts operations on the user's
project. Local commandments provide model guidance; they are not an enforcement
mechanism.

- [agent-interface.ts](../../../../src/lib/agent/agent-interface.ts) configures
  the Anthropic SDK's tool permissions, sandbox, and gateway transport.
- [yara-hooks.ts](../../../../src/lib/yara-hooks.ts) adapts warlock scans to SDK
  tool hooks.
- [Pi security](../../../../src/lib/agent/runner/harness/pi/security.ts) adapts
  shared permissions and scanning to Pi tool-call/result events, including
  blocking, violation latching, and tool-call limits.
- [Pi harness](../../../../src/lib/agent/runner/harness/pi/) explicitly supplies
  tools, scrubs shell environments, and disables project-controlled
  extensions/context loading.
- [triage-provider.ts](../../../../src/lib/agent/triage-provider.ts) supplies
  gateway-backed classification for scanner findings.

Scanner rules live in [warlock](https://github.com/PostHog/warlock); Wizard owns
how its returned categories, severities, and actions affect execution. Scanner
failures must not silently permit unsafe operations, but not every blocked call
terminates the run. Check each adapter's state machine when changing rejection
handling. Preserve useful rejection diagnostics without logging secret content.

Both SDK paths use a scoped gateway token minted through
[gateway-session.ts](../../../../src/lib/gateway-session.ts), not the user's raw
OAuth credential as a model API key. Rejection and refresh behavior belong at
that seam; do not restore a legacy-gateway fallback to bypass admission.

### Secret vault: keeping values out of the model

[secret-vault.ts](../../../../src/lib/secret-vault.ts) stores user-provided
values in memory and returns opaque references. Sensitive `wizard_ask` answers
become `secret:<uuid>` refs; `set_env_values` resolves the ref host-side when
writing. Follow [wizard-tools](../../../../src/lib/wizard-tools/) and the Pi
adapters when adding a secret-consuming tool. Return references and metadata to
the agent, never the raw value. References are session-scoped, not durable
credentials.

## UI state and agent output

Business logic uses [WizardUI](../../../../src/ui/wizard-ui.ts) through
`getUI()`. [InkUI](../../../../src/ui/tui/ink-ui.ts) updates the TUI store;
[LoggingUI](../../../../src/ui/logging-ui.ts) is available for noninteractive
callers that select it. A missing TTY does not automatically mean an arbitrary
caller uses LoggingUI; snapshot CI drives Ink in a PTY. `requestQuestion` and
task notices are supported interactions, not console prompts to invent in
business logic.

Harness adapters translate SDK messages, status markers, task updates and tool
activity into WizardUI calls. Anthropic message processing lives in
[agent-interface.ts](../../../../src/lib/agent/agent-interface.ts); Pi uses its
own session event handlers. Orchestrated tasks also have queue and handoff
state. Do not assume all harness output passes through `handleSDKMessage`.

Session changes go through explicit store setters. They emit updates,
re-evaluate gates, detect transitions, and refresh rendering. The
[router](../../../../src/ui/tui/router.ts) resolves overlays first, then the
first visible incomplete screen from
[screen-sequences.ts](../../../../src/ui/tui/screen-sequences.ts). Those
sequences are projected from registered program steps. Change the
state/predicate that represents progress rather than adding imperative
navigation.

## MCP and instrumentation

Remote PostHog tools, local wizard tools, and optional framework MCP servers are
separate surfaces. The Anthropic SDK's MCP integration and Pi's adapter expose
them differently; inspect the selected harness rather than assuming identical
tool names or discovery. Context-mill supplies skills and flow/task prompts.

[Middleware](../../../../src/lib/middleware/) provides opt-in message/phase
instrumentation. The linear sequence creates the benchmark pipeline; there is no
pipeline construction in the compatibility `agent-runner.ts`. Inspect the actual
consumer before extending instrumentation to another sequence or harness.
