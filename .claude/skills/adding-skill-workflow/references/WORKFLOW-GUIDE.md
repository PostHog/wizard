# Adding a New Skill-Based Workflow

How to add a new workflow to the wizard (like revenue analytics) that installs a skill from context-mill and lets the agent follow it.

## Prerequisites

- A skill published to context-mill with a `SKILL.md` and workflow files
- The skill registered in the skill menu under a category (e.g. `revenue-analytics-setup`)

## Steps

### 1. Define the workflow steps

Create `wizard/src/lib/workflows/<your-workflow>.ts`:

```typescript
import type { Workflow } from '../workflow-step.js';
import { RunPhase } from '../wizard-session.js';

export const YOUR_WORKFLOW: Workflow = [
  {
    id: 'auth',
    label: 'Authentication',
    screen: 'auth',
    isComplete: (s) => s.credentials !== null,
  },
  {
    id: 'run',
    label: 'Your workflow label',
    screen: 'run',
    isComplete: (s) =>
      s.runPhase === RunPhase.Completed || s.runPhase === RunPhase.Error,
  },
  {
    id: 'outro',
    label: 'Done',
    screen: 'outro',
    isComplete: (s) => s.outroDismissed,
  },
];
```

If your workflow needs a health check or setup confirmation, add `gate` predicates and `onInit` callbacks to the relevant steps:

**Example: Adding a setup confirmation gate**

A gate blocks bin.ts from proceeding until its predicate returns true. Here, the `intro` step blocks until the user confirms setup:

```typescript
{
  id: 'intro',
  label: 'Welcome',
  screen: 'intro',
  gate: (s) => s.setupConfirmed,       // bin.ts awaits store.getGate('intro')
  isComplete: (s) => s.setupConfirmed,  // router advances past this screen
},
```

**Example: Adding a health check with async init**

The `onInit` callback fires during store construction. Here it kicks off a health check while the user is still on the intro screen. The gate blocks until the result arrives:

```typescript
import {
  evaluateWizardReadiness,
  WizardReadiness,
} from '../health-checks/readiness.js';

{
  id: 'health-check',
  label: 'Health check',
  screen: 'health-check',
  gate: (s) => {
    if (!s.readinessResult) return false;
    if (s.readinessResult.decision === WizardReadiness.No)
      return s.outageDismissed;  // user must dismiss blocking outage
    return true;
  },
  isComplete: (s) => {
    if (!s.readinessResult) return false;
    if (s.readinessResult.decision === WizardReadiness.No)
      return s.outageDismissed;
    return true;
  },
  onInit: (ctx) => {
    evaluateWizardReadiness()
      .then((readiness) => ctx.setReadinessResult(readiness))
      .catch(() => ctx.setReadinessResult({
        decision: WizardReadiness.Yes,
        health: {} as never,
        reasons: [],
      }));
  },
},
```

If your workflow doesn't have these steps, the gates simply don't exist and `store.getGate('...')` resolves immediately.

### 2. Register the flow

In `wizard/src/ui/tui/flows.ts`:

1. Add to the `Flow` enum:
```typescript
export enum Flow {
  Wizard = 'wizard',
  Revenue = 'revenue',
  YourFlow = 'your-flow',  // add
  // ...
}
```

2. Add to `WORKFLOW_STEPS`:
```typescript
export const WORKFLOW_STEPS: Partial<Record<Flow, Workflow>> = {
  [Flow.Wizard]: POSTHOG_INTEGRATION_WORKFLOW,
  [Flow.Revenue]: REVENUE_ANALYTICS_WORKFLOW,
  [Flow.YourFlow]: YOUR_WORKFLOW,  // add
};
```

3. Add to `FLOWS`:
```typescript
[Flow.YourFlow]: workflowToFlowEntries(YOUR_WORKFLOW) as FlowEntry[],
```

### 3. Create the runner

The runner is split into two parts:

1. **A `detect` workflow step** — checks prerequisites, selects the right skill, and downloads it. This is workflow-specific (framework detection for integration, payment provider for revenue, etc.)
2. **A thin runner function** that reads the skill path from the session and hands off to `runSkillBootstrap`

The detect step lives in the workflow definition (step 1). Here's how revenue does it:

```typescript
// In wizard/src/lib/workflows/revenue-analytics.ts

const POSTHOG_SDKS = ['posthog-js', 'posthog-node', 'posthog-react-native', ...];
const STRIPE_SDKS = ['stripe', '@stripe/stripe-js'];
const SKILL_ID = 'revenue-analytics-stripe';

{
  id: 'detect',
  label: 'Detecting prerequisites',
  // No screen — headless step. Runs via onInit, blocks via gate.
  gate: (s) =>
    s.frameworkContext.skillPath != null ||
    s.frameworkContext.detectError != null,
  onInit: (ctx) => {
    // 1. Read package.json, check for PostHog + Stripe SDKs
    // 2. If either missing → ctx.setFrameworkContext('detectError', '...')
    // 3. If both found → fetch skill menu, download skill
    // 4. On success → ctx.setFrameworkContext('skillPath', '.claude/skills/...')
    // 5. On failure → ctx.setFrameworkContext('detectError', '...')
    //
    // The gate resolves once either skillPath or detectError is set.
    // bin.ts awaits store.getGate('detect'), then checks for detectError.
  },
},
```

In `bin.ts`, the revenue command awaits the detect gate and checks for errors:

```typescript
await tui.store.getGate('detect');

const detectError = tui.store.session.frameworkContext.detectError as string | undefined;
if (detectError) {
  console.error(detectError);
  process.exit(1);
  return;
}
```

The runner itself is trivial — it reads the skill path and delegates:

```typescript
// wizard/src/lib/revenue-runner.ts
import { runSkillBootstrap } from './skill-runner';
import type { WizardSession } from './wizard-session';

export async function runRevenueWizard(session: WizardSession): Promise<void> {
  // Skill was already downloaded by the detect workflow step
  const skillPath = session.frameworkContext.skillPath as string;

  await runSkillBootstrap(session, {
    skillPath,
    integrationLabel: 'revenue-analytics-setup',
    promptContext: 'Set up revenue analytics for this project.',
    successMessage: 'Revenue analytics configured!',
    reportFile: 'posthog-revenue-report.md',
    docsUrl: 'https://posthog.com/docs/revenue-analytics',
    spinnerMessage: 'Setting up revenue analytics...',
    estimatedDurationMinutes: 5,
  });
}
```

This separation matters because different workflows need different detection:
- **Revenue**: checks for PostHog + Stripe, could later detect payment provider
- **Integration**: detects framework, version, project type before picking a skill
- **Future "error tracking"**: might detect error library (Sentry vs Bugsnag) first

### 4. Add the CLI command

In `wizard/bin.ts`, add a new command:

```typescript
program
  .command('your-command')
  .description('Set up X')
  .action(async (options) => {
    // Prerequisite checks (e.g. verify required packages are installed)
    // ...

    const { startTUI } = await import('./src/ui/tui/start-tui.js');
    const { buildSession } = await import('./src/lib/wizard-session.js');
    const { Flow } = await import('./src/ui/tui/router.js');

    const tui = startTUI(WIZARD_VERSION, Flow.YourFlow);

    const session = buildSession({
      debug: options.debug,
      localMcp: options.localMcp,
      installDir,
      ci: false,
    });
    tui.store.session = session;
    tui.store.session.setupConfirmed = true;  // skip intro if no intro step

    await tui.store.getGate('health-check');  // resolves immediately if no health step

    const { runYourWizard } = await import('./src/lib/your-runner.js');
    await runYourWizard(tui.store.session);
  });
```

### 5. Verify

1. `npm test` — all tests should pass (no store changes needed)
2. Run your command: `npx posthog-wizard your-command`
3. Verify the outro shows your success message and report file

## Architecture Notes

- **Workflow steps** (`workflow-step.ts`) are the single source of truth for flow structure, gates, and init work
- **The store** derives gate promises from step definitions — no per-flow hardcoding
- **The skill runner** (`skill-runner.ts`) handles the full lifecycle: skill install, agent init, prompt, error handling, outro
- **The outro screen** reads `outroData.message` and `outroData.reportFile` — no hardcoded strings
- Adding a new workflow requires **zero changes** to the store or outro screen
