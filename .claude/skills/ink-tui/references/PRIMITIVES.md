# Wizard primitives

Use [primitives/index.ts](../../../../src/tui/primitives/index.ts) for public
exports and each source file for its current props. Shared styling lives in
[styles.ts](../../../../src/tui/styles.ts).

## Choose an existing component

| Need                    | Component and behavior                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App shell               | [ScreenContainer](../../../../src/tui/primitives/ScreenContainer.tsx): title, screen transitions, hints, token HUD, viewport guard, and error boundary              |
| Small-terminal notice   | [ViewportTooSmall](../../../../src/tui/primitives/ViewportTooSmall.tsx): minimum dimensions and wrapping for the shared guard                                       |
| Tabs and status         | [TabContainer](../../../../src/tui/primitives/TabContainer.tsx): local active tab, arrow navigation, optional expandable status                                     |
| Single/multiple choice  | [PickerMenu](../../../../src/tui/primitives/PickerMenu.tsx): columns, paging, filtering, and confirm-button interaction                                             |
| Categorized choices     | [GroupedPickerMenu](../../../../src/tui/primitives/GroupedPickerMenu.tsx): category headers, scrolling, and multi-select                                            |
| Multi-select submission | [ConfirmButton](../../../../src/tui/primitives/ConfirmButton.tsx): bordered submit row with focus and optional count                                                |
| Continue/cancel         | [ConfirmationInput](../../../../src/tui/primitives/ConfirmationInput.tsx): text choices, left/right focus, enter activates, escape cancels                          |
| Prompt heading          | [PromptLabel](../../../../src/tui/primitives/PromptLabel.tsx)                                                                                                       |
| Task progress           | [ProgressList](../../../../src/tui/primitives/ProgressList.tsx): active labels, completion count, and skipped-task handling                                         |
| Loading state           | [LoadingBox](../../../../src/tui/primitives/LoadingBox.tsx)                                                                                                         |
| Planned events          | [EventPlanViewer](../../../../src/tui/primitives/EventPlanViewer.tsx)                                                                                               |
| Two panes               | [SplitView](../../../../src/tui/primitives/SplitView.tsx): equal-width panes with a gap                                                                             |
| Aligned content         | [CardLayout](../../../../src/tui/primitives/CardLayout.tsx): horizontal/vertical alignment                                                                          |
| Divider                 | [Divider](../../../../src/tui/primitives/Divider.tsx): measures width on mount                                                                                      |
| Modal layout            | [ModalOverlay](../../../../src/tui/primitives/ModalOverlay.tsx): presentation for interrupt screens                                                                 |
| Terminal links          | [LinkText](../../../../src/tui/primitives/LinkText.tsx) and [link helpers](../../../../src/tui/primitives/link-helpers.ts)                                       |
| Log tail                | [LogViewer](../../../../src/tui/primitives/LogViewer.tsx): bounded tail reads and throttled file watching                                                           |
| HN feed                 | [HNViewer](../../../../src/tui/primitives/HNViewer.tsx): fetches stories and handles its navigation                                                                 |
| Progressive content     | [ContentSequencer](../../../../src/tui/primitives/ContentSequencer.tsx): renders blocks from [content-types.ts](../../../../src/tui/primitives/content-types.ts) |
| Screen transition       | [DissolveTransition](../../../../src/tui/primitives/DissolveTransition.tsx): shared wipe animation                                                                  |
| Shared hints            | [KeyboardHintsBar](../../../../src/tui/primitives/KeyboardHintsBar.tsx): renders registered bindings                                                                |
| Render failure          | [ScreenErrorBoundary](../../../../src/tui/primitives/ScreenErrorBoundary.tsx)                                                                                       |

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
[InputDemo](../../../../src/tui/playground/demos/InputDemo.tsx) for realistic
props and the
[picker tests](../../../../src/tui/__tests__/picker-filter.test.ts) for
filtering behavior.

## Extend the catalog

Keep new layout components focused on reusable props and rendering. Existing
infrastructure primitives may own state, subscriptions, or file/network I/O;
that is not a reason to put program-specific behavior in a new primitive.

Export a public component from the barrel, add a
[playground demo](../../../../src/tui/playground/demos/), and register it in
[PlaygroundApp](../../../../src/tui/playground/PlaygroundApp.tsx). Run
`pnpm try --playground` to review its actual terminal output.
