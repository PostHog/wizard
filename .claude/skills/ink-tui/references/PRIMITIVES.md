# TUI Layout Primitives

Custom layout primitives for the PostHog Setup Wizard TUI. These replace raw Ink/`@inkjs/ui` usage with opinionated, styled components that enforce visual consistency.

**Import**: All primitives are barrel-exported from `src/ui/tui/primitives/index.ts`.

```ts
import { ScreenContainer, TabContainer, PickerMenu, ... } from '../primitives/index.js';
```

**Styles**: Shared constants live in `src/ui/tui/styles.ts`.

```ts
import { Colors, Icons, HAlign, VAlign } from '../styles.js';

Colors.accent   // '#F9BD2B' — hex gold, used for highlights and active states
Colors.primary  // 'cyan' — informational
Colors.success  // 'green' — completed states
Colors.error    // 'red' — errors
Colors.muted    // 'gray' — inactive/dim elements

Icons.diamond          // ◆  filled diamond
Icons.diamondOpen      // ◇  open diamond
Icons.triangleSmallRight // ▸  selector cursor
Icons.squareFilled     // ◼  selected checkbox
Icons.squareOpen       // ◻  unselected checkbox
Icons.triangleRight    // ▶  in-progress indicator
Icons.check            // ✔  checkmark
Icons.warning          // ⚠  warning
```

---

## ScreenContainer

Top-level app shell. Renders TitleBar, routes between screens via `store.currentScreen`, and plays a horizontal wipe transition on screen push/pop.

```tsx
<ScreenContainer
  store={store}
  screens={{
    welcome: <WelcomeScreen />,
    run: <TabContainer tabs={...} />,
    outro: <OutroScreen />,
  }}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `store` | `WizardStore` | Reactive store instance |
| `screens` | `Record<string, ReactNode>` | Map of screen name → content |

**Screen navigation** (via store):
- `store.pushScreen('run')` — push screen, wipe left
- `store.popScreen()` — pop screen, wipe right
- `store.setScreen('welcome')` — replace stack, wipe left
- `store.currentScreen` — getter, returns top of `screenStack`
- `store.lastNavDirection` — `'push' | 'pop' | null`, set automatically

**File**: `src/ui/tui/primitives/ScreenContainer.tsx`

---

## TabContainer

Self-contained tabbed interface with status bar. Manages its own active tab state. Arrow keys switch tabs.

```tsx
<TabContainer
  tabs={[
    { id: 'status', label: 'Status', component: <StatusTab /> },
    { id: 'logs', label: 'Logs', component: <LogViewer filePath="..." /> },
  ]}
  statusMessage="Setup in progress..."
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `tabs` | `TabDefinition[]` | `{ id, label, component }` for each tab |
| `statusMessage` | `string?` | Optional status line above tab bar (rendered in muted) |

**Layout** (top to bottom):
1. Active tab content (`flexGrow`)
2. Status bar (single-line, top border, muted text)
3. Spacer
4. Tab bar (active = inverse accent, inactive = muted)

**File**: `src/ui/tui/primitives/TabContainer.tsx`

---

## PickerMenu

Single and multi select. Fully custom renderers — does NOT use `@inkjs/ui` Select/MultiSelect.

### Single select

```tsx
<PickerMenu
  message="Pick a framework"
  options={[
    { label: 'Next.js', value: 'nextjs', hint: 'recommended' },
    { label: 'React', value: 'react' },
  ]}
  onSelect={(value) => handleSelect(value)}
/>
```

- Prompt in bordered box (accent color, `borderStyle="single"`)
- `▸` triangle cursor on focused item, accent color + bold
- Unfocused items are dim
- Up/down arrows navigate, enter selects

### Multi select

```tsx
<PickerMenu
  message="Select features"
  mode="multi"
  options={[
    { label: 'Analytics', value: 'analytics' },
    { label: 'Session Replay', value: 'replay' },
  ]}
  onSelect={(values) => handleSelect(values)}
/>
```

- `◻` open square (gray) = unselected, `◼` filled square (white) = selected
- Space toggles, enter submits
- Focused item in accent, unfocused dim

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Prompt text (shown in bordered header) |
| `options` | `Array<{ label, value, hint? }>` | Choices |
| `mode` | `'single' \| 'multi'` | Default `'single'` |
| `onSelect` | `(value: T \| T[]) => void` | Callback with selected value(s) |

**File**: `src/ui/tui/primitives/PickerMenu.tsx`

---

## ConfirmationInput

Continue/cancel prompt with two bordered button boxes.

```tsx
<ConfirmationInput
  message="Deploy to production?"
  onConfirm={() => deploy()}
  onCancel={() => abort()}
/>
```

- Prompt in bordered accent box
- Two buttons: `Continue [Enter]` | `Cancel [Esc]`
- Left/right arrows switch focus, enter activates focused, escape always cancels
- Focused button: accent border + bold text. Unfocused: muted.

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Prompt text |
| `onConfirm` | `() => void` | Enter callback |
| `onCancel` | `() => void` | Escape callback |

**File**: `src/ui/tui/primitives/ConfirmationInput.tsx`

---

## DissolveTransition

Horizontal wipe with split-flap/digital rain texture. Used internally by ScreenContainer but can be used standalone.

```tsx
<DissolveTransition
  transitionKey={screenName}
  width={80}
  height={24}
  direction="left"
>
  {content}
</DissolveTransition>
```

When `transitionKey` changes:
1. **Out phase** (5 frames): a band of shade characters (░▒▓█) with sparse random glyphs sweeps across, covering old content
2. **Content swap**: children replaced at midpoint (invisible behind solid █)
3. **In phase** (5 frames): band sweeps away, revealing new content

| Prop | Type | Description |
|------|------|-------------|
| `transitionKey` | `string` | Change triggers animation |
| `width` | `number` | Grid columns |
| `height` | `number` | Grid rows |
| `children` | `ReactNode` | Content to display |
| `direction` | `'left' \| 'right'` | Wipe direction. Default `'left'` |
| `duration` | `number` | ms per frame. Default `30` |

**File**: `src/ui/tui/primitives/DissolveTransition.tsx`

---

## ProgressList

Task checklist with status icons. Extracted from StatusTab.

```tsx
<ProgressList
  title="Setup in progress:"
  items={[
    { label: 'Install deps', status: 'completed' },
    { label: 'Configure SDK', activeForm: 'Configuring...', status: 'in_progress' },
    { label: 'Verify', status: 'pending' },
  ]}
/>
```

- `◼` green = completed, `▶` cyan = in-progress, `◻` gray = pending
- Shows `activeForm` text when in-progress (replaces label)
- Progress counter: `2/3 completed`

| Prop | Type | Description |
|------|------|-------------|
| `items` | `ProgressItem[]` | `{ label, activeForm?, status }` |
| `title` | `string?` | Optional heading above list |

**File**: `src/ui/tui/primitives/ProgressList.tsx`

---

## CardLayout

Aligns a single child within available space using flexbox alignment.

```tsx
<CardLayout hAlign={HAlign.Center} vAlign={VAlign.Center}>
  <Text>Centered content</Text>
</CardLayout>
```

| Prop | Type | Description |
|------|------|-------------|
| `hAlign` | `HAlign` | Horizontal alignment. Default `HAlign.Left` |
| `vAlign` | `VAlign` | Vertical alignment. Default `VAlign.Top` |
| `children` | `ReactNode` | Content |

**File**: `src/ui/tui/primitives/CardLayout.tsx`

---

## SplitView

Two-pane horizontal layout: 2/3 left, 1/3 right.

```tsx
<SplitView
  left={<MainContent />}
  right={<Sidebar />}
  gap={2}
/>
```

| Prop | Type | Description |
|------|------|-------------|
| `left` | `ReactNode` | Left pane (66% width) |
| `right` | `ReactNode` | Right pane (34% width) |
| `gap` | `number` | Gap between panes. Default `2` |

**File**: `src/ui/tui/primitives/SplitView.tsx`

---

## LogViewer

Real-time log file tail. Watches a file and displays the latest lines.

```tsx
<LogViewer filePath="/tmp/posthog-wizard.log" maxLines={200} />
```

| Prop | Type | Description |
|------|------|-------------|
| `filePath` | `string` | Path to log file |
| `maxLines` | `number` | Lines to show. Default `200` |

**File**: `src/ui/tui/primitives/LogViewer.tsx`

---

## LoadingBox

Spinner with message. Uses `@inkjs/ui` Spinner.

```tsx
<LoadingBox message="Installing dependencies..." />
```

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Text beside spinner |

**File**: `src/ui/tui/primitives/LoadingBox.tsx`

---

## Design conventions

- **Borders**: Always `borderStyle="single"` (not `"round"`) for cross-terminal compatibility
- **Accent color**: `Colors.accent` (`#F9BD2B`) for highlights, active states, prompt headers
- **Dim for inactive**: Use `dimColor` on unfocused/inactive items
- **Muted for secondary**: `Colors.muted` (`gray`) for status text, inactive tabs, borders
- **No bare strings**: All text must be in `<Text>` (Ink requirement)
- **Hex color caution**: Hex colors (like `Colors.accent`) can bleed in some terminals. If a component's text unexpectedly inherits color, set an explicit `color` on its `<Text>` elements.
