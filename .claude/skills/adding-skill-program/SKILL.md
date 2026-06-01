---
name: adding-skill-program
description: Create a new skill-based program for the PostHog wizard. Use when adding a program type (like revenue analytics, audit, error tracking) that installs a context-mill skill and runs an agent against it. Covers the createSkillProgram factory for the common case, customization via ProgramRun, and advanced patterns for custom screens or detection.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "2.0"
---

# Adding a Skill-Based Program

A skill-based program installs a context-mill skill and runs the agent against it. Examples in the codebase: the `audit` program (clean factory call), the `revenue-analytics` program (factory + custom intro screen + detect step).

Before reading this, read `wizard-development/SKILL.md` for the architectural context — particularly principle 4 ("New capability is a new program, not a new branch").

## Architecture

The wizard's runner pipeline is fixed. What varies between programs is a `ProgramRun` configuration object that controls the skill ID, prompt, success message, abort cases, and post-run hooks. A `ProgramConfig` ties together: the CLI command, the step list, and the `ProgramRun`. The program registry derives all downstream wiring — CLI subcommands, TUI programs, the router — from a single array. **Adding a program is configuration, not code.**

## The common case: `createSkillProgram`

For programs that just install a skill and let the agent run it (most programs), use the factory in `agent-skill/index.ts`:

```ts
// src/lib/programs/error-tracking/index.ts
import { createSkillProgram } from '../agent-skill/index.js';

export const errorTrackingConfig = createSkillProgram({
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
  requires: ['posthog-integration'],  // optional: prior programs that must run first
});
```

Then register it in one place:

1. `src/lib/programs/program-registry.ts` — add to `PROGRAM_REGISTRY` array

That's the entire program. **bin.ts, the store, the agent runner, the router, and the screen sequences (`src/ui/tui/screen-sequences.ts`) all derive their wiring from the registry automatically.** Don't add a yargs command. Don't add a runner function. Don't touch bin.ts. The `ProgramId` union type updates itself from the registry contents.

The `audit` program (`src/lib/programs/audit/`) is the cleanest example of this pattern.

## Customizing the agent run

`createSkillProgram` accepts these optional fields on `SkillProgramOptions`, all of which flow through to the `ProgramRun`:

| Option | Purpose |
|---|---|
| `customPrompt` | Extra prompt instructions appended after the default project prompt |
| `buildOutroData` | Override the default outro. Receives session, credentials, cloud region. Returns `OutroData`. |
| `abortCases` | Array of `{ match: RegExp, message, body, docsUrl? }` that match `[ABORT] <reason>` signals from the skill |
| `requires` | Other program `flowKey`s that must be satisfied first |

For more complex post-agent work (env var upload, dashboard creation, anything that needs to run after the agent completes but before the outro), drop the factory and build the `ProgramConfig` directly so you can set `ProgramRun.postRun`. See `posthog-integration` for that pattern.

## Dynamic run configuration

If your program needs to inspect the session before building the run config (read framework context, seed state on disk, set per-session prompt fragments), pass an async function as the program's `run`:

```ts
const baseConfig = createSkillProgram({ /* ... */ });

const dynamicRun = async (session: WizardSession): Promise<ProgramRun> => {
  // do per-session work here (e.g. seed a ledger, populate frameworkContext)
  if (!baseConfig.run) throw new Error('missing run');
  return typeof baseConfig.run === 'function'
    ? baseConfig.run(session)
    : baseConfig.run;
};

export const yourConfig: ProgramConfig = {
  ...baseConfig,
  run: dynamicRun,
};
```

The `audit` program uses this pattern to seed a checks ledger on disk before the agent run.

## Custom screens

Skill-based programs default to the generic step list in `agent-skill/steps.ts` (intro → auth → run → outro → keep-skills). To use program-specific screens (a custom intro that displays detection results, a custom outro with program-specific bullets), override the relevant step's `screen` field:

```ts
const SCREEN_BY_STEP: Record<string, string> = {
  intro: 'your-intro',
  outro: 'your-outro',
};

const yourSteps: ProgramStep[] = AGENT_SKILL_STEPS.map((step) => {
  const override = SCREEN_BY_STEP[step.id];
  return override ? { ...step, screen: override } : step;
});

export const yourConfig: ProgramConfig = {
  ...baseConfig,
  steps: yourSteps,
};
```

Then:

1. Add the screen IDs to the `ScreenId` enum in `src/ui/tui/screen-sequences.ts`
2. Create the React component(s) under `src/ui/tui/screens/`
3. Register them in `src/ui/tui/screen-registry.tsx`

The screen reads from the store (via `useWizardStore`), renders error states from `frameworkContext.detectError` if present, and calls `store.completeSetup()` (or equivalent) when the user advances. The router resolves the active screen from session state — see `wizard-development/references/ARCHITECTURE.md` for the full screen resolution flow. **Never call `console.error` or imperatively navigate from inside the TUI.**

## Detection / prerequisite checking

If your program needs to verify prerequisites before showing the intro screen (e.g. PostHog must already be installed, certain SDKs must be present), add a headless detect step at the top of the program with an `onReady` hook:

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

The `revenue-analytics` program is the canonical example of this pattern (detect step + custom intro + abort cases).

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

- `src/lib/programs/audit/` — clean `createSkillProgram` call with abort cases, custom screens, and a dynamic `run` function for per-session seeding
- `src/lib/programs/revenue-analytics/` — factory + custom intro screen + detect step with prerequisite checking
- `src/lib/programs/agent-skill/` — the factory itself (`createSkillProgram`) and the generic step list (`AGENT_SKILL_STEPS`)

When in doubt, read the directory of the program that most resembles what you're building.
