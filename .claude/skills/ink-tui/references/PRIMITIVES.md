# Wizard primitives

Use [primitives/index.ts](../../../../src/ui/tui/primitives/index.ts) for public
exports and each source file for its current props. Shared styling lives in
[styles.ts](../../../../src/ui/tui/styles.ts).

## Choose an existing component

| Need                    | Component and behavior                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell               | [ScreenContainer](../../../../src/ui/tui/primitives/ScreenContainer.tsx): title, screen transitions, hints, token HUD, viewport guard, and error boundary              |
| Small-terminal notice   | [ViewportTooSmall](../../../../src/ui/tui/primitives/ViewportTooSmall.tsx): minimum dimensions and wrapping for the shared guard                                       |
| Tabs and status         | [TabContainer](../../../../src/ui/tui/primitives/TabContainer.tsx): local active tab, arrow navigation, optional expandable status                                     |
| Single/multiple choice  | [PickerMenu](../../../../src/ui/tui/primitives/PickerMenu.tsx): columns, paging, filtering, and confirm-button interaction                                             |
| Categorized choices     | [GroupedPickerMenu](../../../../src/ui/tui/primitives/GroupedPickerMenu.tsx): category headers, scrolling, and multi-select                                            |
| Multi-select submission | [ConfirmButton](../../../../src/ui/tui/primitives/ConfirmButton.tsx): bordered submit row with focus and optional count                                                |
| Continue/cancel         | [ConfirmationInput](../../../../src/ui/tui/primitives/ConfirmationInput.tsx): text choices, left/right focus, enter activates, escape cancels                          |
| Prompt heading          | [PromptLabel](../../../../src/ui/tui/primitives/PromptLabel.tsx)                                                                                                       |
| Task progress           | [ProgressList](../../../../src/ui/tui/primitives/ProgressList.tsx): active labels, completion count, and skipped-task handling                                         |
| Loading state           | [LoadingBox](../../../../src/ui/tui/primitives/LoadingBox.tsx)                                                                                                         |
| Planned events          | [EventPlanViewer](../../../../src/ui/tui/primitives/EventPlanViewer.tsx)                                                                                               |
| Two panes               | [SplitView](../../../../src/ui/tui/primitives/SplitView.tsx): equal-width panes with a gap                                                                             |
| Aligned content         | [CardLayout](../../../../src/ui/tui/primitives/CardLayout.tsx): horizontal/vertical alignment                                                                          |
| Divider                 | [Divider](../../../../src/ui/tui/primitives/Divider.tsx): measures width on mount                                                                                      |
| Modal layout            | [ModalOverlay](../../../../src/ui/tui/primitives/ModalOverlay.tsx): presentation for interrupt screens                                                                 |
| Terminal links          | [LinkText](../../../../src/ui/tui/primitives/LinkText.tsx) and [link helpers](../../../../src/ui/tui/primitives/link-helpers.ts)                                       |
| Log tail                | [LogViewer](../../../../src/ui/tui/primitives/LogViewer.tsx): bounded tail reads and throttled file watching                                                           |
| HN feed                 | [HNViewer](../../../../src/ui/tui/primitives/HNViewer.tsx): fetches stories and handles its navigation                                                                 |
| Progressive content     | [ContentSequencer](../../../../src/ui/tui/primitives/ContentSequencer.tsx): renders blocks from [content-types.ts](../../../../src/ui/tui/primitives/content-types.ts) |
| Screen transition       | [DissolveTransition](../../../../src/ui/tui/primitives/DissolveTransition.tsx): shared wipe animation                                                                  |
| Shared hints            | [KeyboardHintsBar](../../../../src/ui/tui/primitives/KeyboardHintsBar.tsx): renders registered bindings                                                                |
| Render failure          | [ScreenErrorBoundary](../../../../src/ui/tui/primitives/ScreenErrorBoundary.tsx)                                                                                       |

The directory also contains internal block renderers and layout helpers. Prefer
the public exports for composition; read the implementation before depending on
an internal helper.

## Multi-select behavior

Both picker primitives place a `ConfirmButton` after the options. Arrow keys
navigate through options and onto that button. Enter toggles an option or
submits when the button is focused. Grouped selection also supports `a` for all
options. Space aliases enter except when `PickerMenu` has an active filter,
where space is text input.

Use these controls for new multi-select surfaces so submission behavior and
keyboard hints stay consistent. See
[InputDemo](../../../../src/ui/tui/playground/demos/InputDemo.tsx) for realistic
props and the
[picker tests](../../../../src/ui/tui/__tests__/picker-filter.test.ts) for
filtering behavior.

## Extend the catalog

Keep new layout components focused on reusable props and rendering. Existing
infrastructure primitives may own state, subscriptions, or file/network I/O;
that is not a reason to put program-specific behavior in a new primitive.

Export a public component from the barrel, add a
[playground demo](../../../../src/ui/tui/playground/demos/), and register it in
[PlaygroundApp](../../../../src/ui/tui/playground/PlaygroundApp.tsx). Run
`pnpm try --playground` to review its actual terminal output.
