---
name: ink-tui
description: >
  Build or modify the PostHog wizard's Ink screens, primitives, keyboard
  interactions, and session-driven screen flow. Use for TUI work in this
  repository.
license: MIT
metadata:
  author: posthog
  version: '2.0'
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

1. Create a component in [screens](../../../src/ui/tui/screens/).
2. Add its `ScreenId` in
   [screen-sequences.ts](../../../src/ui/tui/screen-sequences.ts).
3. Register the component in
   [screen-registry.tsx](../../../src/ui/tui/screen-registry.tsx).
4. Reference it through `screenId` in the owning
   [program's steps](../../../src/lib/programs/), with the appropriate
   visibility, completion, and gate predicates.

Screen sequences derive from program steps. Do not hand-maintain a second
sequence array or add program navigation to the router. Additional state or
service wiring depends on the screen's needs; `App` remains the shared shell.

## Preserve the UI boundary

Business logic calls [WizardUI](../../../src/ui/wizard-ui.ts) through
[getUI](../../../src/ui/index.ts). Screens use
[WizardStore](../../../src/ui/tui/store.ts) setters for reactive changes. The
router resolves program screens from session predicates; overlays interrupt that
resolution. Local state is appropriate for presentation details such as tab
selection, not wizard progression.

For new state, first decide whether it belongs in
[WizardSession](../../../src/lib/wizard-session.ts) or display-only store state.
Use an explicit setter that notifies subscribers. When business logic needs the
operation, extend `WizardUI`, [InkUI](../../../src/ui/tui/ink-ui.ts), and
[LoggingUI](../../../src/ui/logging-ui.ts) together. Reuse existing enums and
union types rather than introducing competing status vocabularies.

## Reuse and check

Compose existing primitives and use [styles.ts](../../../src/ui/tui/styles.ts)
for shared colors, icons, and alignment. Export new public primitives from
[primitives/index.ts](../../../src/ui/tui/primitives/index.ts), add a realistic
[playground demo](../../../src/ui/tui/playground/demos/), and register it in
[PlaygroundApp.tsx](../../../src/ui/tui/playground/PlaygroundApp.tsx).

Run `pnpm try --playground` to inspect primitives. Use
[exploring-the-wizard](../exploring-the-wizard/SKILL.md) when exercising actual
screen flows. Follow the repository's validation guidance; choose focused
behavior checks for changed predicates or input handling, and visual inspection
for layout changes.
