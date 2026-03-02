---
name: ink-tui-wizard
description: >
  Build terminal user interfaces (TUIs) using Ink (React for CLIs) and @inkjs/ui
  with a reactive, session-driven wizard pattern. Use when creating interactive CLI
  installation wizards, setup flows, or multi-step terminal applications in
  Node.js/TypeScript. Covers reactive screen resolution, declarative flow pipelines,
  overlay interrupts, session state management, Ink components, Flexbox terminal layout,
  and graceful degradation across terminal environments.
license: MIT
compatibility: Requires Node.js 18+. Designed for Claude Code or similar coding agents.
metadata:
  author: posthog
  version: "0.2"
  domain: cli-tui
---

# Ink TUI Wizard Skill

Build beautiful, interactive terminal wizard interfaces using Ink (React for CLIs).

Ink is the dominant Node.js TUI framework — used by Claude Code (Anthropic), Gemini CLI
(Google), GitHub Copilot CLI, Cloudflare Wrangler, Shopify CLI, Prisma, and many others.

## When to use this skill

- Creating multi-step CLI installation or setup wizards
- Building reactive, session-driven terminal interfaces
- Adding real-time progress, spinners, or status displays to CLI tools
- Any Node.js/TypeScript CLI that needs more than sequential prompts

## Core architecture

This skill follows a **reactive session-driven** pattern: the rendered screen is a pure
function of session state. Business logic sets state through store setters. The router
derives which screen should be active. Nobody imperatively pushes screens around.

See [references/ARCHITECTURE.md](references/ARCHITECTURE.md) for the full reactive
architecture: session, router, store, screen resolution, overlays, and data flow.

### Key concepts

- **WizardSession** — single source of truth for all wizard decisions
- **WizardRouter** — declarative flow pipelines with `isComplete` predicates per screen
- **WizardStore** — EventEmitter with explicit setters that trigger React re-renders
- **Screen registry** — factory function mapping screen names to components (App.tsx never changes)
- **Services** — injected into screens via props (no dynamic imports in React components)
- **Overlays** — interrupt stack for outage/error modals, orthogonal to flows

### Adding a screen

1. Create the component in `src/ui/tui/screens/`
2. Add to `Screen` enum in `router.ts`
3. Add a `FlowEntry` to the flow array with an `isComplete` predicate
4. Register in `screen-registry.tsx`

No other files change.

### Layout primitives layer

The project has reusable layout primitives in `src/ui/tui/primitives/`.
**Always use these instead of building from scratch.**

Key primitives:
- **ScreenContainer** — top-level shell, routes between screens with wipe transitions, wraps each screen in ScreenErrorBoundary
- **PromptLabel** — accent-colored `→` badge + message label. Used by all input primitives.
- **PickerMenu** — single/multi select with `centered` prop support
- **ConfirmationInput** — continue/cancel with arrow key toggle
- **ProgressList** — task checklist with status icons, spinner on tally, LoadingBox when empty
- **TabContainer** — self-contained tabbed interface with status bar
- **DissolveTransition** — horizontal wipe with split-flap texture
- **SplitView** — 50/50 two-pane layout
- **CardLayout** — centered content card
- **LogViewer / LoadingBox** — log tail and spinner

See [references/PRIMITIVES.md](references/PRIMITIVES.md) for the full API and usage
examples. Shared style constants (`Colors`, `Icons`, `HAlign`, `VAlign`) live in
`src/ui/tui/styles.ts`.

**Playground**: Run `pnpm try --playground` to see all primitives in action.

### Enums everywhere

All state comparisons use TypeScript enums — no string literals:

- `Screen` — flow screen names (Intro, Setup, Auth, Run, Mcp, Outro, etc.)
- `Overlay` — interrupt screen names (Outage)
- `Flow` — named flow pipelines (Wizard, McpAdd, McpRemove)
- `RunPhase` — lifecycle phase (Idle, Running, Completed, Error)
- `OutroKind` — outro outcome (Success, Error, Cancel)

### Key dependencies

```
ink                   # Core: React renderer for terminals (uses Yoga for Flexbox)
react                 # Peer dependency
@inkjs/ui             # Official component library: Select, TextInput, Spinner,
                      # ProgressBar, ConfirmInput, MultiSelect, Badge,
                      # StatusMessage, Alert, OrderedList, UnorderedList
figures               # Unicode/ASCII symbol fallbacks (cross-platform)
```

**Do NOT use** the older standalone packages (`ink-text-input`, `ink-select-input`,
`ink-spinner`). The `@inkjs/ui` package supersedes them.

### Project structure

```
src/ui/tui/
├── App.tsx                    # Thin shell — calls screen registry factory
├── store.ts                   # WizardStore: EventEmitter + session setters
├── router.ts                  # WizardRouter: flow pipelines + overlay stack
├── ink-ui.ts                  # InkUI: bridges getUI() calls to store setters
├── start-tui.ts               # TUI startup: dark mode, store, renderer
├── screen-registry.tsx         # Maps screen names to components + services
├── styles.ts                  # Colors, Icons, alignment enums
├── screens/
│   ├── IntroScreen.tsx        # Detection → framework picker → region picker
│   ├── SetupScreen.tsx        # Generic framework disambiguation
│   ├── AuthScreen.tsx         # OAuth waiting state with login URL
│   ├── RunScreen.tsx          # Split view: TipsCard + ProgressList, tabbed with logs
│   ├── McpScreen.tsx          # MCP server installation via McpInstaller service
│   ├── OutroScreen.tsx        # Success/error/cancel summary
│   └── OutageScreen.tsx       # Service degradation overlay
├── primitives/
│   ├── ScreenContainer.tsx    # Screen routing + error boundary wrapper
│   ├── ScreenErrorBoundary.tsx # Catches render crashes → error outro
│   ├── PromptLabel.tsx        # → badge + accent label for input prompts
│   ├── PickerMenu.tsx         # Single/multi select with centered support
│   ├── ConfirmationInput.tsx  # Continue/cancel with arrow toggle
│   ├── ProgressList.tsx       # Task checklist with spinner + LoadingBox
│   ├── TabContainer.tsx       # Tabbed interface with status bar
│   ├── SplitView.tsx          # 50/50 two-pane layout
│   ├── DissolveTransition.tsx # Horizontal wipe animation
│   ├── CardLayout.tsx         # Centered content card
│   ├── LoadingBox.tsx         # Spinner with message
│   └── LogViewer.tsx          # Log file tail viewer
├── services/
│   └── mcp-installer.ts      # McpInstaller interface + factory
└── components/
    └── TitleBar.tsx           # Top bar with version + feedback email
```

## Ink rendering model

Ink is `react-dom` but for terminals. It uses Yoga (Facebook's Flexbox engine) for layout.
Every `<Box>` is a flex container. All visible text MUST be inside `<Text>`.

| Browser             | Ink                                            |
| ------------------- | ---------------------------------------------- |
| `<div>`             | `<Box>`                                        |
| `<span>`            | `<Text>`                                       |
| CSS / className     | Props directly on `<Box>` and `<Text>`         |
| `onClick`           | `useInput()` hook                              |
| `window.innerWidth` | `useStdout().stdout.columns`                   |
| scroll              | `<Box overflow="hidden">` + manual offset      |
| `display: block`    | `<Box flexDirection="column">`                 |
| `display: flex`     | Default — every `<Box>` is already flex        |

## Terminal compatibility

- **Small terminals**: Check `useStdout().stdout.columns` and `.rows`
- **Piped input**: Detect `!process.stdin.isTTY` and fall back to LoggingUI
- **CI environments**: `--ci` flag uses LoggingUI (no TUI, no prompts)
- **Dark mode**: `start-tui.ts` forces black background via ANSI escape codes
- **True black text**: Use `color="#000000"` not `color="black"` (terminals render ANSI black as grey)
- **Ctrl+C**: Ink handles via `useApp().exit()`

## Reference files

- [references/ARCHITECTURE.md](references/ARCHITECTURE.md) — **Reactive architecture**: session, router, store, screen resolution, overlays, data flow, enums, store setters, WizardUI bridge. **Read this first when working on screen flow or state.**
- [references/PRIMITIVES.md](references/PRIMITIVES.md) — **TUI layout primitives**: API reference for ScreenContainer, PromptLabel, PickerMenu, ConfirmationInput, ProgressList, and all custom components.
- [references/INK-API.md](references/INK-API.md) — Complete Ink component and hook API reference
- [references/INKJS-UI.md](references/INKJS-UI.md) — @inkjs/ui component catalog with examples
- [references/TERMINAL-COMPAT.md](references/TERMINAL-COMPAT.md) — Terminal detection and graceful degradation
- [references/PATTERNS.md](references/PATTERNS.md) — Layout patterns and design recipes
- [scripts/scaffold.sh](scripts/scaffold.sh) — Bootstrap a new Ink wizard project
