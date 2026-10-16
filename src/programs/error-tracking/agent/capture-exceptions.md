---
type: capture-exceptions
flow: error-tracking
label: Wire up exception capture
model_pi: openai/gpt-5.6-sol
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: high
skills: [integration-v2-error-tracking-step, posthog-best-practices]
allowedTools: [Read, Write, Edit, Glob, Grep]
disallowedTools: [enqueue_task]
dependsOn: [install, init]
---

## Goal

Make the errors the app does not catch reach PostHog, by whatever means the
SDK offers for that. Which means depends on the SDK: some autocapture
exceptions once you enable it at init, some wire into the framework's own
error handler, some give you a boundary to mount at the app entry. Follow the
docs and the reference example for this one, and set it up in one place —
never manual capture calls sprinkled across files.

A page often shows two setups side by side: a global initializer, and an
explicit client you hold. Follow one of them the whole way through. Taking the
wiring from one and the calls from the other reads fine and compiles nowhere —
an initializer that hands back nothing leaves you nothing to call methods on.

The SDK is installed and initialized — either it already was, or the install
and init tasks before you did it (see their handoffs); build on that, do not
re-check it.

This is an instrument-only task. Do not install dependencies, run the build,
run tests, or start the app — the user-driven test-setup step at the end of
the flow verifies, when the user wants it. Do not touch the build config
either way; when the flow includes a configure task, it owns those files.
Stay inside this project's directory and set up that one place; that is the
whole job.

## Do not copy the SDK's own listeners

Exception autocapture already registers the global handlers: `window.onerror`
and `unhandledrejection` in the browser, `uncaughtException` and
`unhandledRejection` in Node, `sys.excepthook` in Python, the panic hook in
Rust, and the uncaught-exception and signal handlers on iOS and Android. Turn
that on with the SDK's own option — `capture_exceptions`,
`enableExceptionAutocapture`, `enable_exception_autocapture`, `capture_panics`,
`errorTrackingConfig.autoCapture` — and register none of those handlers
yourself. A second listener on the same event sends every error twice, and it
stops matching the SDK's handling the moment the SDK changes.

What the SDK cannot see is yours to add: errors a framework catches before any
global handler fires. Express error middleware, Fastify `setErrorHandler`, Hono
`onError`, Vue `app.config.errorHandler`, Angular `ErrorHandler`, SvelteKit
`handleError`, a React error boundary, Next.js `global-error` — hook those,
because the framework swallows the error and the global listener never hears
of it. A platform with no autocapture at all, such as Go, is the other case:
there the capture boundary at the entry point is the mechanism, not a copy of
one.

## How you know you succeeded

An error the app does not catch reaches PostHog, through the mechanism this
SDK gives you rather than one you invented, and no global error listener of
your own sits beside the SDK's autocapture. You did not install anything, run
a build, lint, or tests, search outside the project, or read through the whole
app or hand-wrap individual components or routes. Your handoff names the files
you changed and the capture mechanism, so the report can explain it to the
user.
