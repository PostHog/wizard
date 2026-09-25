---
title: Anti-patterns and alternatives
description: Common ways a Wizard change crosses the wrong boundary.
---

# Anti-patterns

Use the [architecture map](ARCHITECTURE.md) to find each surface's current
implementation. Prefer the smallest change that keeps ownership explicit.

## Product logic inside infrastructure

A runner branch that knows about a dashboard, framework, or revenue provider
couples unrelated programs. Put that behavior in program configuration or
context-mill content. Linear programs can use `postRun`; orchestrated work
belongs in the flow/tasks or its completion path. The orchestrator does not
invoke linear post-run hooks.

## Growing prompts into duplicate documentation

Keep local commandments to short runtime/tool guidance. Framework procedures
belong in context-mill skills and references. Gateway-required safety policy
belongs in gateway infrastructure; duplicating it in Wizard creates another copy
that can drift. Adding a model constant does not update gateway admission.

## Recovery machinery for a missing boundary

Before adding retries or repair loops for unsafe agent behavior, inspect tool
permissions, scanner rules, and task instructions. Prevent disallowed operations
before they execute. Recovery still has a place for transient transport
failures; do not remove justified retry or refresh behavior merely to reduce
line count.

## Imperative navigation and implicit prerequisites

Do not add a second navigation mechanism beside the router. Update the session
state that a step's `show`, `isComplete`, or `gate` predicate reads. Use the
existing overlay mechanism for a real overlay.

`requires` documents a prerequisite but does not run it. Detect prerequisites
explicitly or compose work through `ProgramStep.run`. Use store setters for
shared session data; do not rely on another program having populated it by
accident. Shared detection can be a function called by both `onReady` hooks.

## Bundling fast-changing integration knowledge

Context-mill publishes integration skills and agent flows independently of the
Wizard release. Keep framework/product tutorials there; Wizard owns their typed
configuration and execution. A content-only change in an existing command family
should not acquire a second native implementation.

## Unbounded output in one model response

A large report or structured document can outlive a provider/proxy connection or
consume excessive context. For large artifacts, write a bounded skeleton and
fill sections in separate tool calls, preserving progress on disk. This does not
guarantee a particular timeout or make the final upload unbounded. A small
configuration or short report is clearer as one write.
