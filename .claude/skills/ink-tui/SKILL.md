---
name: ink-tui
description: >
  Build or modify the PostHog wizard's Ink screens, primitives, keyboard
  interactions, and session-driven screen flow. Use for TUI work in this
  repository.
license: MIT
metadata:
  author: posthog
  version: '3.1'
---

# Ink TUI

The wizard renders its terminal interface with Ink and React. Pi is an agent
harness; it does not replace this renderer. Read
[wizard-development](../wizard-development/SKILL.md) for architecture and
harness/sequence policy before structural changes.

## Start with the existing surface

- For screen flow or state, read [ARCHITECTURE.md](references/ARCHITECTURE.md).
- For layout or controls, read [PRIMITIVES.md](references/PRIMITIVES.md) and the
  relevant component's props.
- For composition and keyboard behavior, read
  [PATTERNS.md](references/PATTERNS.md).
- For terminal sizing, startup, or noninteractive behavior, read
  [TERMINAL-COMPAT.md](references/TERMINAL-COMPAT.md).

[package.json](../../../package.json) owns supported versions: currently Node
≥22.22.0, Ink `^6.8.0`, React `^19.2.4`, and `@inkjs/ui ^2.0.0`. Use installed
package types for API details; keep this skill focused on the wizard's
conventions rather than copying upstream component manuals.

## Add a screen

A screen one program owns:

1. Create the component in `src/tui/programs/<id>/screens/`.
2. Add its id to that folder's `screen-ids.ts`.
3. Map the id to the component in the `screens` of the folder's entry
   (`index.ts(x)`), and add its commits to the harness
   [action registry](../../../e2e-harness/action-registry.ts), or list it in
   `NO_ACTION_SCREENS` if it has none. The registry's exhaustiveness test in
   `e2e-harness/__tests__/wizard-ci-driver.test.ts` fails a screen in neither.
4. Reference it through `screenId` in the program's flow (`flow.ts`, or the
   `AGENT_SKILL_STEPS` a skill program adapts), with the appropriate
   visibility, completion, and gate predicates.

A tool's screens follow the same steps in `src/tui/tools/<id>/`, whose entry
exports `TUI_TOOLS`; see [src/tools](../../../src/tools/README.md).

A screen several programs or the core use lives in
[screens](../../../src/tui/screens/), with its id in
[screen-ids.ts](../../../src/tui/screen-ids.ts) and its mount in
[screen-registry.tsx](../../../src/tui/screen-registry.tsx). Screen sequences
derive from each program's flow. Do not hand-maintain a second sequence array or
add program navigation to the router. Additional state or service wiring depends
on the screen's needs; `App` remains the shared shell.

## Preserve the UI boundary

Programs never use the UI. They get a runner context from
[runner-context.ts](../../../src/programs/runner-context.ts). TUI code, the
login included, takes the [WizardStore](../../../src/tui/store.ts) it reports
through as an argument: `pushStatus` for a line, `showOutroError` for an error
outro, and [abortOnScreens](../../../src/tui/abort.ts) for a decided failure.
There is no UI interface shared with headless or the CLI. Screens use store
setters for reactive changes. The router resolves program screens from step
predicates over the session and the TUI state; overlays interrupt that
resolution. Local state is appropriate for presentation details such as tab
selection, not wizard progression.

For new state, first decide whether it belongs in
the shared [WizardSession](../../../src/programs/session/wizard-session.ts),
which extends the [ProgramSession](../../../src/programs/program-session.ts)
programs read, in the TUI's own [TuiState](../../../src/tui/tui-state.ts) when
only screens read it, or in display-only store state. Use an explicit setter
that notifies subscribers. When TUI code needs a new operation to report
through, add it to the store; a run's progress reaches the store through
[agent-progress.ts](../../../src/tui/agent-progress.ts). Reuse existing enums
and union types rather than introducing competing status vocabularies.

## Reuse and check

Compose existing primitives and use [styles.ts](../../../src/tui/styles.ts)
for shared colors, icons, and alignment. Export new public primitives from
[primitives/index.ts](../../../src/tui/primitives/index.ts), add a realistic
[playground demo](../../../src/tui/playground/demos/), and register it in
[PlaygroundApp.tsx](../../../src/tui/playground/PlaygroundApp.tsx).

Run `pnpm try --playground` to inspect primitives. Use
[exploring-the-wizard](../exploring-the-wizard/SKILL.md) when exercising actual
screen flows. Follow the repository's validation guidance; choose focused
behavior checks for changed predicates or input handling, and visual inspection
for layout changes.
