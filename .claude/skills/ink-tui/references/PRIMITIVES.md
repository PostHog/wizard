# TUI Layout Primitives

Custom layout primitives for the PostHog Setup Wizard TUI. These replace raw Ink/`@inkjs/ui` usage with opinionated, styled components that enforce visual consistency.

**Import**: All primitives are barrel-exported from `src/ui/tui/primitives/index.ts`.

```ts
import { ScreenContainer, TabContainer, PickerMenu, ... } from '../primitives/index.js';
```

**Styles**: Shared constants live in `src/ui/tui/styles.ts` — read that file for current `Colors`, `Icons`, `HAlign`, `VAlign` values.

---

## Primitive catalog

Each primitive's props interface is defined in its source file. Read the file for the current API.

### ScreenContainer
`src/ui/tui/primitives/ScreenContainer.tsx`

Top-level app shell. Renders TitleBar, routes between screens via `store.currentScreen` (router-driven), and plays a horizontal wipe transition on screen changes. Wraps each screen in `ScreenErrorBoundary`.

### TabContainer
`src/ui/tui/primitives/TabContainer.tsx`

Self-contained tabbed interface with status bar. Manages its own active tab state. Arrow keys switch tabs.

Layout (top to bottom):
1. Active tab content (`flexGrow`)
2. Status bar (single-line, top border, muted text)
3. Spacer
4. Tab bar (active = inverse accent, inactive = muted)

Tabs array can be built conditionally — see `RunScreen.tsx` for an example of a tab that only appears when data is available.

### PickerMenu
`src/ui/tui/primitives/PickerMenu.tsx`

Single and multi select. Fully custom renderers — does NOT use `@inkjs/ui` Select/MultiSelect.

- **Single select**: `▸` triangle cursor on focused item, enter selects
- **Multi select** (`mode="multi"`): `◻`/`◼` toggles with space, enter submits

### ConfirmationInput
`src/ui/tui/primitives/ConfirmationInput.tsx`

Continue/cancel prompt with two bordered button boxes. Left/right arrows switch focus, enter activates focused, escape always cancels.

### DissolveTransition
`src/ui/tui/primitives/DissolveTransition.tsx`

Horizontal wipe with split-flap/digital rain texture. Used internally by ScreenContainer. When `transitionKey` changes, a band of shade characters sweeps across covering old content, then reveals new content.

### ProgressList
`src/ui/tui/primitives/ProgressList.tsx`

Task checklist with status icons and progress counter. Shows a `LoadingBox` placeholder when items array is empty.

- `◼` green = completed, `▶` cyan = in-progress, `◻` gray = pending
- Shows `activeForm` text when in-progress (replaces label)

### EventPlanViewer
`src/ui/tui/primitives/EventPlanViewer.tsx`

Pure render component for planned analytics events. Takes an `events` array prop and renders each event name (bold) with description (dim). Used in RunScreen's conditional "Event plan" tab.

### SplitView
`src/ui/tui/primitives/SplitView.tsx`

Two-pane horizontal layout (50/50 split).

### CardLayout
`src/ui/tui/primitives/CardLayout.tsx`

Aligns a single child within available space using flexbox alignment (`HAlign`, `VAlign`).

### LogViewer
`src/ui/tui/primitives/LogViewer.tsx`

Real-time log file tail. Watches a file with `fs.watch` and displays the latest lines that fit in the available terminal height.

### LoadingBox
`src/ui/tui/primitives/LoadingBox.tsx`

Spinner with message. Uses `@inkjs/ui` Spinner.

---

## Design conventions

- **Borders**: Always `borderStyle="single"` (not `"round"`) for cross-terminal compatibility
- **Accent color**: `Colors.accent` for highlights, active states, prompt headers
- **Dim for inactive**: Use `dimColor` on unfocused/inactive items
- **Muted for secondary**: `Colors.muted` for status text, inactive tabs, borders
- **No bare strings**: All text must be in `<Text>` (Ink requirement)
- **Hex color caution**: Hex colors (like `Colors.accent`) can bleed in some terminals. If a component's text unexpectedly inherits color, set an explicit `color` on its `<Text>` elements.
