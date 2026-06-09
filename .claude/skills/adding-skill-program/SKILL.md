---
name: adding-skill-program
description: Create a new skill-based program for the PostHog wizard. Use when adding a program type (like revenue analytics, audit, error tracking) that installs a context-mill skill and runs an agent against it. Covers the two-repo flow (context-mill for CLI surface, wizard for run mechanics), the createSkillProgram factory for custom hooks, and advanced patterns for custom screens or detection.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "3.0"
---

# Adding a Skill-Based Program

A skill-based program installs a context-mill skill and runs the agent against it. The CLI surface (command name, description, where it nests) lives in context-mill; the run mechanics (hooks, content blocks, abort cases) live in the wizard. **Adding a new skill-backed command is usually a context-mill PR, not a wizard PR.**

Before reading this, read `wizard-development/SKILL.md` for the architectural context — particularly principle 4 ("New capability is a new program, not a new branch") — and the [wizard CONTRIBUTING.md](../../../../CONTRIBUTING.md) for the CLI convention and the contributor decision tree.

## The two-repo split

| Concern | Lives in |
|---|---|
| CLI surface — command name, description, where it nests (`parentCommand`) | **context-mill** — `transformation-config/skills/<name>/config.yaml` `cli:` block |
| Skill content — markdown that drives the agent (steps, examples, docs) | **context-mill** — `transformation-config/skills/<name>/` directory |
| Run mechanics — custom prompts, content blocks, abort cases, post-run hooks | **wizard** — `src/lib/programs/<name>/` (only if you need overrides) |
| Default skill-runner behavior (intro, auth, run, outro, keep-skills) | **wizard** — `src/lib/programs/agent-skill/` (the generic dispatcher) |

The wizard's `skillCommandFactory` overrides any base config's `skillId` with the manifest entry's `skillId` at dispatch time. So a single shared config — the generic `agentSkillConfig` — can back many manifest entries. Most new skill-backed commands don't need a wizard-side ProgramConfig at all.

## Decision: do I need a wizard PR?

```
Adding a new public skill-backed command?
│
├── Generic skill run (default intro/outro, no custom hooks)
│   → context-mill PR only. Wizard picks it up automatically on next release.
│   → Examples: future audit-* subcommands beyond what's already shipping.
│
└── Custom hooks needed (custom outro, abort cases, content blocks, detect step)
    → context-mill PR for the skill + cli: block
    → wizard PR for a ProgramConfig with the overrides
    → Examples: audit (custom content blocks), revenue-analytics (custom detect),
      migration (custom abort cases)
```

## Step 1 — context-mill: declare the skill and its surface

In context-mill, create `transformation-config/skills/<your-skill>/`:

```yaml
# transformation-config/skills/your-skill/config.yaml
type: docs-only
template: description.md
description: Set up PostHog error tracking
tags: [error-tracking]
cli:
  surface: public
  command: errors          # the user-typed word: `wizard errors`
  # parentCommand: <foo>   # uncomment to nest under another command
variants:
  - id: all
    display_name: PostHog error tracking
```

Then add `description.md`, any `references/*.md` files, and run `npm test && npm run build` in context-mill. Confirm the entry appears in `dist/skills/cli-manifest.json` with the values you expect.

See [context-mill CONTRIBUTING.md](https://github.com/PostHog/context-mill/blob/main/CONTRIBUTING.md) for the full `cli:` block schema, the YAML→command mapping table, and the promotion criterion for `surface: public`. Naming convention rules (kebab-case, length 2–20, no reserved words, no internal-flag collisions) are enforced by `parseCliBlock` at build time.

**At this point, if your skill needs no custom hooks, you're done.** The wizard's next release will pick up the manifest entry and register `wizard <command>` automatically via `skillCommandFactory(entry, agentSkillConfig)`. No wizard PR needed.

## Step 2 (optional) — wizard: add a ProgramConfig for custom hooks

If the skill needs custom run mechanics — a non-default outro, abort cases, a detect step, content blocks for the run screen — add a `ProgramConfig` in the wizard.

For most cases, use the `createSkillProgram` factory in `agent-skill/index.ts`:

```ts
// src/lib/programs/error-tracking/index.ts
import { createSkillProgram } from '../agent-skill/index.js';

export const errorTrackingConfig = createSkillProgram({
  skillId: 'error-tracking-setup',  // matches the context-mill skill id
  id: 'error-tracking',
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

**Note:** `createSkillProgram` accepts a `command` field for backwards compatibility with wizard-native programs, but for skill-backed commands the CLI surface comes from the manifest entry (not from `command`). The skill factory overrides any `skillId` on the dispatched config with the manifest entry's `skillId`, so a single config can back multiple commands.

Then:

1. Add `errorTrackingConfig` to `PROGRAM_REGISTRY` in `src/lib/programs/program-registry.ts` — this lets the runner look up the config by `skillId` (so dispatch can attach the right hooks).
2. If your command needs to dispatch through this config (not the generic `agentSkillConfig`), wire it explicitly in a per-family command file (see `src/commands/audit.ts` for the `resolveAuditConfig` pattern that picks specialized configs by `skillId`).

bin.ts, the store, the agent runner, the router, and the screen sequences (`src/ui/tui/screen-sequences.ts`) all derive their wiring from the registry automatically. You shouldn't need to add a yargs command — the `skillCommandFactory` plus manifest iteration handles registration.

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

## Family parents (`wizard audit`, `wizard migrate`)

If the new command belongs in an existing family (like adding `wizard audit something-new`), all you need is the context-mill PR with `parentCommand: audit` in the `cli:` block. The wizard's `audit.ts` iterates the manifest and adds the new child automatically.

If you're creating a **new family parent**, that's a wizard PR:

1. Add a wizard-native parent command file (see `src/commands/audit.ts` for the pattern — iterate manifest entries with `parentCommand: <yourname>`, wrap with `skillCommandFactory`, expose as a `Command` with `children` and an `interactiveDefault` for the family picker).
2. Add it to `bin.ts`'s `Wizard.use(...)` chain.

## Verification

```bash
pnpm build
pnpm test
pnpm fix
```

If your change touches the CLI surface (added a wizard-native command, updated `cli-manifest.bootstrap.json`, restructured a family), regenerate the public reference:

```bash
pnpm docs:cli   # writes docs/cli.md from the bootstrap manifest + native commands
```

`docs/cli.md` is committed but auto-generated. Skipping the regen ships a stale public-facing reference; the next contributor will hit a confusing diff.

Then run end-to-end against a real test app:

```bash
pnpm try --install-dir=<path> <your-command>
```

Test failure cases too — missing prerequisites, bad install directories, network errors during skill download. The wizard should render structured error outros, not stack traces.

## Canonical examples in the codebase

- **`src/lib/programs/audit/`** — specialized config that's dispatched by `audit.ts` based on `skillId === 'audit'` (the comprehensive audit). Other audit children (`events`, `flags`, etc.) dispatch through the generic `agentSkillConfig` with the manifest entry's `skillId`.
- **`src/lib/programs/migration/`** — single config (`migrationConfig`) that backs every `wizard migrate <vendor>` child via `skillCommandFactory`'s `skillId` override.
- **`src/lib/programs/revenue-analytics/`** — flat skill command (`wizard revenue`) with a specialized config; the per-family file `src/commands/revenue.ts` finds the manifest entry by skillId and wraps with `skillCommandFactory`.
- **`src/lib/programs/agent-skill/`** — the generic dispatcher (`createSkillProgram`, `agentSkillConfig`, `AGENT_SKILL_STEPS`) used by every skill-backed command that doesn't need custom hooks.

When in doubt, read the directory of the program that most resembles what you're building, plus the `src/commands/<family>.ts` file that wires it into the CLI.
