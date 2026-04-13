---
name: adding-skill-workflow
description: Create a new skill-based workflow for the PostHog wizard. Use when adding a new workflow type (like revenue analytics, error tracking, feature flags) that installs a context-mill skill and runs an agent. Covers workflow steps, detection, flow registration, runner, custom screens, and CLI command.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "1.1"
---

# Adding a Skill-Based Workflow

## Architecture Overview

Skill-based workflows (like revenue analytics) follow a different path from framework integrations. Instead of the agent runner building a prompt from a `FrameworkConfig`, a skill-based workflow:

1. **Detects prerequisites** and downloads a skill from context-mill
2. **Runs the agent** against the installed skill using the generic `skill-runner.ts`
3. **Shows results** via data-driven outro (no hardcoded messages)

Key files:
- `src/lib/workflow-step.ts` — `WorkflowStep` interface with `gate`, `onInit`, `StoreInitContext`
- `src/lib/skill-runner.ts` — Generic runner: takes a skill path, builds bootstrap prompt, runs agent
- `src/lib/wizard-tools.ts` — `fetchSkillMenu()` and `downloadSkill()` for installing skills via code
- `src/utils/file-utils.ts` — Shared `IGNORED_DIRS` for project-tree scans
- `src/ui/tui/flows.ts` — `Flow` enum, `Screen` enum, `WORKFLOW_STEPS`, `FLOWS` maps
- `src/ui/tui/screen-registry.tsx` — Maps screen IDs to React components
- `src/ui/tui/store.ts` — Gate system derived from workflow step definitions

## How It Works

### Store gates

Each workflow step can define a `gate` predicate. The store creates a promise for each gate and checks all predicates after every `emitChange()`. `bin.ts` awaits gates via `store.getGate(stepId)`.

Steps without a gate don't create promises. `store.getGate('nonexistent')` resolves immediately.

### Detect step pattern

Detection is split into two pieces:

1. **A headless `detect` workflow step** with a gate predicate that resolves once `frameworkContext.skillPath` or `frameworkContext.detectError` is set.
2. **An exported `detect*Prerequisites()` async function** that bin.ts calls AFTER the session is assigned to the store.

**Why not `onInit`?** Because `onInit` fires during store construction (inside `_initFromWorkflow`), which runs BEFORE `tui.store.session = session` in bin.ts. Any `onInit` that reads `session.installDir` would get the default `process.cwd()`, not the app directory. `onInit` is fine for session-independent work like the integration flow's health check.

```typescript
// In your workflow file
export async function detectYourPrerequisites(
  session: WizardSession,
  setFrameworkContext: (key: string, value: unknown) => void,
): Promise<void> {
  // Verify session.installDir, scan for required artifacts, fetch + download
  // the skill. On failure: setFrameworkContext('detectError', '...').
  // On success: setFrameworkContext('skillPath', '.claude/skills/...').
  // Optionally store any data the intro screen should render.
}

export const YOUR_WORKFLOW: Workflow = [
  {
    id: 'detect',
    label: 'Detecting prerequisites',
    gate: (s) =>
      s.frameworkContext.skillPath != null ||
      s.frameworkContext.detectError != null,
  },
  // ...
];
```

### Error handling — never console.error from inside the TUI

When the Ink TUI is rendering, calling `console.error` and `process.exit(1)` mangles the screen. Instead, your custom intro screen reads `frameworkContext.detectError` and renders an error view with an Exit option. bin.ts just awaits the intro gate — the screen handles both success and error states.

### StoreInitContext

Available in `onInit` callbacks (use only for session-independent work):
- `ctx.session` — read current session state
- `ctx.setReadinessResult(result)` — store health check results
- `ctx.setFrameworkContext(key, value)` — store detection results
- `ctx.emitChange()` — trigger gate re-evaluation

## Steps to Add a Workflow

### 1. Define workflow steps

Create `src/lib/workflows/<your-workflow>.ts` with a detect step + (optional) intro step + auth + run + outro.

Export `detect*Prerequisites()` as a standalone async function — do NOT put detection in `onInit`.

### 2. Register the flow

In `src/ui/tui/flows.ts`:
- Add to `Flow` enum
- Add to `WORKFLOW_STEPS` map
- Add to `FLOWS` record via `workflowToFlowEntries()`

### 3. Create the runner

The runner is trivial — it reads the skill path from session and delegates to `runSkillBootstrap()`:

```typescript
import { runSkillBootstrap } from './skill-runner';

export async function runYourWizard(session: WizardSession): Promise<void> {
  const skillPath = session.frameworkContext.skillPath as string;

  await runSkillBootstrap(session, {
    skillPath,
    integrationLabel: 'your-workflow',
    promptContext: 'Set up X for this project.',
    successMessage: 'X configured!',
    reportFile: 'posthog-x-report.md',
    docsUrl: 'https://posthog.com/docs/x',
    spinnerMessage: 'Setting up X...',
    estimatedDurationMinutes: 5,
  });
}
```

Use the actual skill ID from context-mill's skill menu — don't guess.

### 4. (Optional) Custom intro screen

If you want a workflow-specific welcome screen, create one. The screen should also handle the `detectError` state since that's where errors are rendered.

**a.** Add a screen ID to the `Screen` enum in `src/ui/tui/flows.ts`.

**b.** Create `src/ui/tui/screens/YourIntroScreen.tsx`. Subscribe to the store, read `detectError` and detection results from `session.frameworkContext`, render either an error view (with Exit) or the welcome view (with Continue/Cancel). On confirm, call `store.completeSetup()`.

**c.** Register it in `src/ui/tui/screen-registry.tsx`.

**d.** Add an intro step to your workflow (after `detect`, before `auth`):
```typescript
{
  id: 'intro',
  label: 'Welcome',
  screen: 'your-intro',
  gate: (s) => s.setupConfirmed,
  isComplete: (s) => s.setupConfirmed,
},
```

In bin.ts, await the intro gate after detect. Don't pre-set `setupConfirmed = true` if you have a custom intro — the user confirms via the screen.

### 5. Add the CLI command

In `bin.ts`, add a yargs command. The pattern:
1. Start the TUI with your `Flow`
2. Build session, assign to store
3. Call `detect*Prerequisites()` explicitly
4. Await `getGate('detect')`
5. Await `getGate('intro')` — the screen handles both error and success states
6. Call your runner
7. Wait for `outroDismissed` via store subscribe, then `process.exit(0)` — without this, the process exits before the user can read the outro

**Do not** `console.error` or `process.exit` for `detectError` from bin.ts — that mangles the Ink output. Let the intro screen render the error.

### 6. Verify

```bash
pnpm build    # Must compile
pnpm test     # All tests pass
```

Then run your command end-to-end against a real test app, including failure cases (missing prerequisites, bad directories) to confirm graceful handling.

## Reference

See `references/WORKFLOW-GUIDE.md` for the full step-by-step guide with complete code examples.

## Canonical Example

`src/lib/workflows/revenue-analytics.ts` — read this for a full working implementation of every piece described above.
