---
name: adding-skill-workflow
description: Create a new skill-based workflow for the PostHog wizard. Use when adding a workflow type (like revenue analytics, audit, error tracking) that installs a context-mill skill and runs an agent against it. Covers the createSkillWorkflow factory for the common case, customization via WorkflowRun, and advanced patterns for custom screens or detection.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "2.0"
---

# Adding a Skill-Based Workflow

A skill-based workflow installs a context-mill skill and runs the agent against it. Examples in the codebase: the `audit` workflow (clean factory call), the `revenue-analytics` workflow (factory + custom intro screen + detect step).

Before reading this, read `wizard-development/SKILL.md` for the architectural context — particularly principle 4 ("New capability is a new workflow, not a new branch").

## Architecture

The wizard's runner pipeline is fixed. What varies between workflows is a `WorkflowRun` configuration object that controls the skill ID, prompt, success message, abort cases, and post-run hooks. A `WorkflowConfig` ties together: the CLI command, the step list, and the `WorkflowRun`. The workflow registry derives all downstream wiring — CLI subcommands, TUI flows, the router — from a single array. **Adding a workflow is configuration, not code.**

## The common case: `createSkillWorkflow`

For workflows that just install a skill and let the agent run it (most workflows), use the factory in `agent-skill/index.ts`:

```ts
// src/lib/workflows/error-tracking/index.ts
import { createSkillWorkflow } from '../agent-skill/index.js';

export const errorTrackingConfig = createSkillWorkflow({
  skillId: 'error-tracking-setup',
  command: 'errors',
  flowKey: 'error-tracking',
  description: 'Set up PostHog error tracking',
  integrationLabel: 'error-tracking',
  successMessage: 'Error tracking configured!',
  reportFile: 'posthog-error-tracking-report.md',
  docsUrl: 'https://posthog.com/docs/error-tracking',
  spinnerMessage: 'Setting up error tracking...',
  estimatedDurationMinutes: 5,
  requires: ['posthog-integration'],  // optional: prior workflows that must run first
});
```

Then register it in two places:

1. `src/lib/workflows/workflow-registry.ts` — add to `WORKFLOW_REGISTRY` array
2. `src/ui/tui/flows.ts` — add a `Flow` enum entry whose value matches `flowKey`

That's the entire workflow. **bin.ts, the store, the agent runner, and the router all derive their wiring from the registry automatically.** Don't add a yargs command. Don't add a runner function. Don't touch bin.ts.

The `audit` workflow (`src/lib/workflows/audit/`) is the cleanest example of this pattern.

## Customizing the agent run

`createSkillWorkflow` accepts these optional fields on `SkillWorkflowOptions`, all of which flow through to the `WorkflowRun`:

| Option | Purpose |
|---|---|
| `customPrompt` | Extra prompt instructions appended after the default project prompt |
| `buildOutroData` | Override the default outro. Receives session, credentials, cloud region. Returns `OutroData`. |
| `abortCases` | Array of `{ match: RegExp, message, body, docsUrl? }` that match `[ABORT] <reason>` signals from the skill |
| `requires` | Other workflow `flowKey`s that must be satisfied first |

For more complex post-agent work (env var upload, dashboard creation, anything that needs to run after the agent completes but before the outro), drop the factory and build the `WorkflowConfig` directly so you can set `WorkflowRun.postRun`. See `posthog-integration` for that pattern.

## Dynamic run configuration

If your workflow needs to inspect the session before building the run config (read framework context, seed state on disk, set per-session prompt fragments), pass an async function as the workflow's `run`:

```ts
const baseConfig = createSkillWorkflow({ /* ... */ });

const dynamicRun = async (session: WizardSession): Promise<WorkflowRun> => {
  // do per-session work here (e.g. seed a ledger, populate frameworkContext)
  if (!baseConfig.run) throw new Error('missing run');
  return typeof baseConfig.run === 'function'
    ? baseConfig.run(session)
    : baseConfig.run;
};

export const yourConfig: WorkflowConfig = {
  ...baseConfig,
  run: dynamicRun,
};
```

The `audit` workflow uses this pattern to seed a checks ledger on disk before the agent run.

## Custom screens

Skill-based workflows default to the generic step list in `agent-skill/steps.ts` (intro → auth → run → outro → keep-skills). To use workflow-specific screens (a custom intro that displays detection results, a custom outro with workflow-specific bullets), override the relevant step's `screen` field:

```ts
const SCREEN_BY_STEP: Record<string, string> = {
  intro: 'your-intro',
  outro: 'your-outro',
};

const yourSteps: Workflow = AGENT_SKILL_STEPS.map((step) => {
  const override = SCREEN_BY_STEP[step.id];
  return override ? { ...step, screen: override } : step;
});

export const yourConfig: WorkflowConfig = {
  ...baseConfig,
  steps: yourSteps,
};
```

Then:

1. Add the screen IDs to the `Screen` enum in `flows.ts`
2. Create the React component(s) under `src/ui/tui/screens/`
3. Register them in `src/ui/tui/screen-registry.tsx`

The screen reads from the store (via `useWizardStore`), renders error states from `frameworkContext.detectError` if present, and calls `store.completeSetup()` (or equivalent) when the user advances. The router resolves the active screen from session state — see `wizard-development/references/ARCHITECTURE.md` for the full screen resolution flow. **Never call `console.error` or imperatively navigate from inside the TUI.**

## Detection / prerequisite checking

If your workflow needs to verify prerequisites before showing the intro screen (e.g. PostHog must already be installed, certain SDKs must be present), add a headless detect step at the top of the workflow with an `onReady` hook:

```ts
{
  id: 'detect',
  label: 'Detecting prerequisites',
  // No screen — this step is headless
  onReady: async (ctx) => {
    // ctx.session.installDir is the user's project dir
    // On success: ctx.setFrameworkContext('skillPath', '...')
    // On failure: ctx.setFrameworkContext('detectError', { kind: '...', ... })
  },
},
```

Use `onReady`, not `onInit` — `onInit` fires during store construction before `session` is assigned, so it can't read `installDir`. The custom intro screen reads `frameworkContext.detectError` and renders an error view (with an Exit option) when present, or the welcome view otherwise.

The `revenue-analytics` workflow is the canonical example of this pattern (detect step + custom intro + abort cases).

## Verification

```bash
pnpm build
pnpm test
pnpm fix
```

Then run end-to-end against a real test app:

```bash
pnpm try --install-dir=<path> <your-command>
```

Test failure cases too — missing prerequisites, bad install directories, network errors during skill download. The wizard should render structured error outros, not stack traces.

## Canonical examples in the codebase

- `src/lib/workflows/audit/` — clean `createSkillWorkflow` call with abort cases, custom screens, and a dynamic `run` function for per-session seeding
- `src/lib/workflows/revenue-analytics/` — factory + custom intro screen + detect step with prerequisite checking
- `src/lib/workflows/agent-skill/` — the factory itself (`createSkillWorkflow`) and the generic step list (`AGENT_SKILL_STEPS`)

When in doubt, read the directory of the workflow that most resembles what you're building.
