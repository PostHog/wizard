---
name: ink-tui-wizard
description: >
  Build terminal user interfaces (TUIs) using Ink (React for CLIs) and @inkjs/ui
  with a tabbed, step-based wizard pattern. Use when creating interactive CLI
  installation wizards, setup flows, or multi-step terminal applications in
  Node.js/TypeScript. Covers Ink components, Flexbox terminal layout, useInput
  hooks, @inkjs/ui widgets, state management, progressive disclosure, and
  graceful degradation across terminal environments.
license: MIT
compatibility: Requires Node.js 18+. Designed for Claude Code or similar coding agents.
metadata:
  author: posthog
  version: "0.1"
  domain: cli-tui
---

# Ink TUI Wizard Skill

Build beautiful, interactive terminal wizard interfaces using Ink (React for CLIs).

Ink is the dominant Node.js TUI framework — used by Claude Code (Anthropic), Gemini CLI
(Google), GitHub Copilot CLI, Cloudflare Wrangler, Shopify CLI, Prisma, and many others.
It has 35k+ GitHub stars.

## When to use this skill

- Creating multi-step CLI installation or setup wizards
- Building tabbed or pane-based terminal interfaces
- Adding real-time progress, spinners, or status displays to CLI tools
- Any Node.js/TypeScript CLI that needs more than sequential prompts

## Core architecture

This skill follows the **Tabbed Wizard** pattern: a top-level tab bar for spatial
awareness combined with guided content panels for each step. The architecture is
standard React — components, hooks, state lifting — rendered to the terminal via Ink.

### Key dependencies

```
ink                   # Core: React renderer for terminals (uses Yoga for Flexbox)
react                 # Peer dependency
@inkjs/ui             # Official component library: Select, TextInput, Spinner,
                      # ProgressBar, ConfirmInput, MultiSelect, Badge,
                      # StatusMessage, Alert, OrderedList, UnorderedList
                      # Includes ThemeProvider for customization
figures               # Unicode/ASCII symbol fallbacks (cross-platform)
```

**Do NOT use** the older standalone packages (`ink-text-input`, `ink-select-input`,
`ink-spinner`). The `@inkjs/ui` package supersedes them with a unified, themeable API.

### Project structure

```
src/
├── cli.tsx                 # Entry point, argument parsing
├── app.tsx                 # Root <App /> component, tab state
├── components/
│   ├── TabBar.tsx          # Tab navigation bar
│   ├── StatusBar.tsx       # Bottom help/status bar
│   ├── StepIndicator.tsx   # Progress dots or checkmarks
│   └── Panel.tsx           # Bordered content panel
├── tabs/
│   ├── SetupTab.tsx        # Framework/language selection
│   ├── ConfigTab.tsx       # Configuration options
│   ├── InstallTab.tsx      # Installation progress
│   └── VerifyTab.tsx       # Post-install verification
├── hooks/
│   ├── useWizardState.ts   # Central wizard state management
│   ├── useTerminalInfo.ts  # Terminal size, color support detection
│   └── useKeyBindings.ts   # Global keyboard shortcut handler
└── utils/
    ├── detect-terminal.ts  # Terminal capability detection
    └── logger.ts           # File-based debug logging (not stdout)
```

## Step-by-step instructions

### 1. Bootstrap the project

```bash
mkdir posthog-wizard && cd posthog-wizard
npm init -y
npm install ink react @inkjs/ui figures
npm install -D typescript @types/react tsx
```

Use `tsx` for development (no Babel config needed):
```bash
npx tsx src/cli.tsx
```

Or scaffold with the official tool:
```bash
npx create-ink-app --typescript my-ink-cli
```

### 2. Understand Ink's rendering model

Ink is `react-dom` but for terminals. It uses Yoga (Facebook's Flexbox engine) for layout.
Every `<Box>` is a flex container (`display: flex` by default). All visible text MUST be
inside `<Text>` — bare strings outside `<Text>` will throw.

Key differences from browser React:

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

### 3. Build the root App component

The root component owns tab state and renders the three-zone layout:

```tsx
// app.tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';

const TABS = ['Setup', 'Config', 'Install', 'Verify'] as const;

export const App = () => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [activeTab, setActiveTab] = useState(0);
  const [completedTabs, setCompletedTabs] = useState<Set<number>>(new Set());

  useInput((input, key) => {
    if (key.leftArrow) setActiveTab(i => Math.max(0, i - 1));
    if (key.rightArrow) setActiveTab(i => Math.min(TABS.length - 1, i + 1));
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" height={stdout.rows}>
      {/* Tab bar */}
      <Box gap={1} paddingX={1}>
        {TABS.map((tab, i) => (
          <Text
            key={tab}
            bold={i === activeTab}
            color={completedTabs.has(i) ? 'green' : i === activeTab ? 'cyan' : 'gray'}
          >
            {completedTabs.has(i) ? '✓' : '○'} {tab}
          </Text>
        ))}
      </Box>

      {/* Divider */}
      <Box paddingX={1}>
        <Text dimColor>{'─'.repeat(Math.min(60, stdout.columns - 2))}</Text>
      </Box>

      {/* Active panel — fills remaining space */}
      <Box flexDirection="column" flexGrow={1} paddingX={2} paddingY={1}>
        {activeTab === 0 && <SetupTab />}
        {activeTab === 1 && <ConfigTab />}
        {activeTab === 2 && <InstallTab />}
        {activeTab === 3 && <VerifyTab />}
      </Box>

      {/* Status bar */}
      <Box paddingX={1} borderStyle="single" borderTop borderColor="gray"
           borderBottom={false} borderLeft={false} borderRight={false}>
        <Text dimColor>←/→ switch tabs · enter confirm · q quit</Text>
      </Box>
    </Box>
  );
};
```

### 4. Use @inkjs/ui components for tab content

`@inkjs/ui` provides production-ready interactive components. See
[references/INKJS-UI.md](references/INKJS-UI.md) for the full component catalog.

```tsx
// tabs/SetupTab.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { Select, StatusMessage } from '@inkjs/ui';

const FRAMEWORKS = [
  { label: 'Next.js', value: 'nextjs' },
  { label: 'React (Vite)', value: 'react-vite' },
  { label: 'Vue', value: 'vue' },
  { label: 'Svelte', value: 'svelte' },
  { label: 'Node.js (Express)', value: 'node-express' },
];

export const SetupTab = ({ onSelect }: { onSelect: (fw: string) => void }) => {
  return (
    <Box flexDirection="column" gap={1}>
      <Text bold>Select your framework:</Text>
      <Select options={FRAMEWORKS} onChange={onSelect} />
      <StatusMessage variant="info">
        PostHog supports all major frameworks
      </StatusMessage>
    </Box>
  );
};
```

### 5. Add installation progress with `<Static>`

Use Ink's `<Static>` component for completed items that should not re-render,
and live components below for in-progress work:

```tsx
import React, { useState, useEffect } from 'react';
import { Box, Text, Static } from 'ink';
import { Spinner, ProgressBar, StatusMessage } from '@inkjs/ui';

const InstallTab = ({ config }) => {
  const [completed, setCompleted] = useState([]);
  const [current, setCurrent] = useState(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    runInstallation(config, {
      onStepStart: (step) => setCurrent(step),
      onStepComplete: (step) => {
        setCompleted(prev => [...prev, step]);
        setCurrent(null);
      },
      onProgress: setProgress,
    });
  }, []);

  return (
    <Box flexDirection="column">
      {/* Completed steps — rendered once, never re-rendered */}
      <Static items={completed}>
        {(step) => (
          <Box key={step.id}>
            <StatusMessage variant="success">{step.label}</StatusMessage>
          </Box>
        )}
      </Static>

      {/* Current step — live updates */}
      {current && (
        <Box gap={1}>
          <Spinner label={current.label} />
        </Box>
      )}

      {/* Progress bar */}
      <Box width={40} marginTop={1}>
        <ProgressBar value={progress} />
      </Box>
    </Box>
  );
};
```

### 6. Handle focus management

Use Ink's built-in `useFocus` and `useFocusManager` for navigating between
interactive elements within a tab:

```tsx
import { useFocus, useFocusManager } from 'ink';

const FocusableItem = ({ label, onActivate }) => {
  const { isFocused } = useFocus();
  return (
    <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
      {isFocused ? '>' : ' '} {label}
    </Text>
  );
};

// In parent, use useFocusManager to control focus programmatically:
const { focusNext, focusPrevious } = useFocusManager();
```

## Common edge cases

- **Small terminals**: Check `useStdout().stdout.columns` and `.rows`. If < 60 columns,
  collapse tab labels to icons or abbreviations. If < 20 rows, switch to inline mode.
- **Piped input**: Detect `!process.stdin.isTTY` and fall back to non-interactive defaults
  or `@inquirer/prompts`.
- **CI environments**: Detect `process.env.CI` and skip interactive elements entirely.
- **Windows terminals**: Use the `figures` package for Unicode → ASCII fallbacks. Test in
  PowerShell and CMD, not just Windows Terminal.
- **SSH sessions**: Ink works over SSH but color support may vary. Respect `NO_COLOR`
  and `FORCE_COLOR` environment variables.
- **Ctrl+C handling**: Ink handles this via `useApp().exit()`. Ensure in-progress
  installations have cleanup handlers via `useEffect` return functions.
- **Text wrapping**: All text must be inside `<Text>`. Use `wrap="truncate"` on `<Text>`
  (or `truncate-start`, `truncate-middle`) to control overflow behavior.

## Reference files

- [references/INK-API.md](references/INK-API.md) — Complete Ink component and hook API reference
- [references/INKJS-UI.md](references/INKJS-UI.md) — @inkjs/ui component catalog with examples
- [references/TERMINAL-COMPAT.md](references/TERMINAL-COMPAT.md) — Terminal detection and graceful degradation
- [references/PATTERNS.md](references/PATTERNS.md) — Layout patterns, state management, and design recipes
- [scripts/scaffold.sh](scripts/scaffold.sh) — Bootstrap a new Ink wizard project
