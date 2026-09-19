# Composition and keyboard patterns

Use existing screens and demos as examples; their props stay checked with the
codebase.

| Task                                                 | Start here                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Compose a run screen with conditional event-plan tab | [RunScreen](../../../../src/ui/tui/screens/RunScreen.tsx)                                                                                       |
| Build a program intro                                | [IntroScreenLayout](../../../../src/ui/tui/screens/IntroScreenLayout.tsx)                                                                       |
| Compose a learning deck                              | [LearnCard](../../../../src/ui/tui/components/LearnCard.tsx), [LearnDeckDemo](../../../../src/ui/tui/playground/demos/LearnDeckDemo.tsx)        |
| Compare layout primitives                            | [LayoutDemo](../../../../src/ui/tui/playground/demos/LayoutDemo.tsx)                                                                            |
| Exercise picker and confirmation controls            | [InputDemo](../../../../src/ui/tui/playground/demos/InputDemo.tsx)                                                                              |
| Add an interaction modal                             | [WizardAskScreen](../../../../src/ui/tui/screens/WizardAskScreen.tsx), [AskModalDemo](../../../../src/ui/tui/playground/demos/AskModalDemo.tsx) |

## Keep progression in session state

A tab's active index is local presentation state. A wizard step completes
through its session predicate and explicit setter. Do not create a parallel
`useWizardState` hook or advance wizard steps through tab callbacks. See
[ARCHITECTURE.md](ARCHITECTURE.md) for screen and gate ownership.

## Keyboard handling

Use [useKeyBindings](../../../../src/ui/tui/hooks/useKeyBindings.ts) for visible
shortcuts: it couples handlers to labels in the shared hints bar.
[KeyboardHintsDemo](../../../../src/ui/tui/playground/demos/KeyboardHintsDemo.tsx)
shows the pattern. Reuse its `KeyMatch` vocabulary and choose a distinct
registration id for each mounted control.

For an ordinary-key dismissal, use
[useDismissOnAnyKey](../../../../src/ui/tui/hooks/useDismissOnAnyKey.ts). It
ignores Ctrl/Meta combinations so the global Ctrl+T HUD shortcut does not also
dismiss the screen.

Ink delivers input to mounted handlers, including components hidden with
`display="none"`. Hiding content does not disable its input or effects.
`TabContainer` mounts only the active tab's content; preserve that behavior
unless the new control explicitly coordinates handlers. Raw `useInput` remains
available for specialized interactions, but consider which other mounted
handlers will receive the same key.

## Layout and diagnostics

Visible text belongs inside Ink `Text`. Reuse the shared color/alignment
constants and the relevant primitive's border treatment. Use
[useStdoutDimensions](../../../../src/ui/tui/hooks/useStdoutDimensions.ts) when
layout must update on terminal resize; reading `useStdout` alone does not
subscribe. Account for the shell's title, hints, tabs, status expansion, and
optional HUD rather than allocating the full terminal height to screen content.

Write diagnostics through [logToFile](../../../../src/utils/debug.ts), which
uses the configured wizard log destination. Avoid introducing a separate
hardcoded temporary log or writing debug lines into the live TUI.
