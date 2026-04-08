<p align="center">
  <img alt="posthoglogo" src="https://user-images.githubusercontent.com/65415371/205059737-c8a4f836-4889-4654-902e-f302b187b6a0.png">
</p>

> **⚠️ Experimental:** This wizard is still in an experimental phase. If you
> have any feedback, please drop an email to **[wizard@posthog.com](mailto:wizard@posthog.com)**.

<h1>PostHog wizard ✨</h1>
<h4>The PostHog wizard helps you quickly add PostHog to your project using AI.</h4>

# Usage

To use the wizard, you can run it directly using:

```bash
npx @posthog/wizard
```

Currently the wizard can be used for **React, NextJS, Svelte, Astro and React
Native** projects. If you have other integrations you would like the wizard to
support, please open a [GitHub issue](https://github.com/posthog/wizard/issues)!

## MCP Commands

The wizard also includes commands for managing PostHog MCP (Model Context
Protocol) servers:

```bash
# Install PostHog MCP server to supported clients
npx @posthog/wizard mcp add

# Remove PostHog MCP server from supported clients
npx @posthog/wizard mcp remove
```

# Options

The following CLI arguments are available:

| Option            | Description                                                      | Type    | Default | Choices                                              | Environment Variable           |
| ----------------- | ---------------------------------------------------------------- | ------- | ------- | ---------------------------------------------------- | ------------------------------ |
| `--help`          | Show help                                                        | boolean |         |                                                      |                                |
| `--version`       | Show version number                                              | boolean |         |                                                      |                                |
| `--debug`         | Enable verbose logging                                           | boolean | `false` |                                                      | `POSTHOG_WIZARD_DEBUG`         |
| `--default`       | Use default options for all prompts                              | boolean | `true`  |                                                      | `POSTHOG_WIZARD_DEFAULT`       |
| `--signup`        | Create a new PostHog account during setup                        | boolean | `false` |                                                      | `POSTHOG_WIZARD_SIGNUP`        |
| `--integration`   | Integration to set up                                            | string  |         | "nextjs", "astro", "react", "svelte", "react-native", "tanstack-router", "tanstack-start" |                                |
| `--menu`          | Show menu for manual integration selection instead of auto-detecting | boolean | `false` |                                                      | `POSTHOG_WIZARD_MENU`          |
| `--force-install` | Force install packages even if peer dependency checks fail       | boolean | `false` |                                                      | `POSTHOG_WIZARD_FORCE_INSTALL` |
| `--install-dir`   | Directory to install PostHog in                                  | string  |         |                                                      | `POSTHOG_WIZARD_INSTALL_DIR`   |
| `--ci`            | Enable CI mode for non-interactive execution                     | boolean | `false` |                                                      | `POSTHOG_WIZARD_CI`            |
| `--api-key`       | PostHog personal API key (phx_xxx) for authentication            | string  |         |                                                      | `POSTHOG_WIZARD_API_KEY`       |

> Note: A large amount of the scaffolding for this came from the amazing Sentry
> wizard, which you can find [here](https://github.com/getsentry/sentry-wizard)
> 💖

# CI Mode

Run the wizard non-interactive executions with `--ci`:

```bash
npx @posthog/wizard --ci --api-key $POSTHOG_PERSONAL_API_KEY --install-dir .
```

When running in CI mode (`--ci`):

- Bypasses OAuth login flow (uses personal API key directly)
- Auto-selects defaults for all prompts
- Skips MCP server installation
- Auto-continues on git warnings (uncommitted/untracked files)
- Auto-consents to AI usage

The CLI args override environment variables in CI mode.

### Required Flags for CI Mode

- `--api-key`: Personal API key (`phx_xxx`) from your [PostHog settings](https://app.posthog.com/settings/user-api-keys)
- `--install-dir`: Directory to install PostHog in (e.g., `.` for current directory)

### Required API Key Scopes

When creating your personal API key, ensure it has the following scopes enabled:

- `user:read` - Required to fetch user information
- `project:read` - Required to fetch project details and API token
- `introspection` - Required for API introspection
- `llm_gateway:read` - Required for LLM gateway access
- `dashboard:write` - Required to create dashboards
- `insight:write` - Required to create insights

# Steal this code

While the wizard works great on its own, we also find the approach used by this
project is
[a powerful way to improve AI agent coding sessions](https://posthog.com/blog/envoy-wizard-llm-agent).
Agents can run CLI tools, which means that conventional code like this can
participate in the AI revolution as well – with all the benefits and control
that conventional code implies.

If you want to use this code as a starting place for your own project, here's a
quick explainer on its structure.

## Entrypoint: `run.ts`

The entrypoint for this tool is `run.ts`. Use this file to interpret arguments
and set up the general flow of the application.

## Analytics

Did you know you can capture PostHog events even for smaller, supporting
products like a command line tool? `src/utils/analytics.ts` is a great example
of how to do it.

This file wraps `posthog-node` with some convenience functions to set up an
analytics session and log events. We can see the usage and outcomes of this
wizard alongside all of our other PostHog product data, and this is very
powerful. For example: we could show in-product surveys to people who have used
the wizard to improve the experience.

## Leave rules behind

Supporting agent sessions after we leave is important. There are plenty of ways
to break or misconfigure PostHog, so guarding against this is key.

`src/utils/rules/add-editor-rules.ts` demonstrates how to dynamically construct
rules files and store them in the project's `.cursor/rules` directory.

## Prompts and LLM interactions

LLM agent sessions are _anti-deterministic_: really, anything can happen.

But using LLMs for code generation is really advantageous: they can interpret
existing code at scale and then modify it reliably.

_If_ they are well prompted.

`src/lib/prompts.ts` demonstrates how to wrap a deterministic fence around a
chaotic process. Every wizard session gets the same prompt, tailored to the
specific files in the project.

These prompts are channeled using `src/utils/query.ts` to an LLM interface we
host. This gives us more control: we can be certain of the model version and
provider which interpret the prompts and modify the files. This way, we can find
the right tools for the job and again, apply them consistently.

This also allows us to pick up the bill on behalf of our customers.

When we make improvements to this process, these are available instantly to all
users of the wizard, no training delays or other ambiguity.

## Running locally

### Quick test without linking

```bash
pnpm try --install-dir=[a path]
```

### Development with auto-rebuild

```bash
pnpm run dev
```

This builds, links globally, and watches for changes. Leave it running - any `.ts` file changes will auto-rebuild. Then from any project:

```bash
wizard --integration=nextjs

# Or use local MCP server:
wizard --integration=nextjs --local-mcp
```

## Testing

To run unit tests, run:

```bash
bin/test
```

To run E2E tests run:

```bash
bin/test-e2e
```

E2E tests are a bit more complicated to create and adjust due to to their mocked
LLM calls. See the `e2e-tests/README.md` for more information.

## Publishing your tool

To make your version of a tool usable with a one-line `npx` command:

1. Edit `package.json`, especially details like `name`, `version`
2. Run [`npm publish`](https://docs.npmjs.com/cli/v7/commands/npm-publish) from
   your project directory
3. Now you can run it with `npx yourpackagename`

# Wizard execution flow

## Full lifecycle

When a user runs `npx @posthog/wizard`, here's what happens end-to-end:

### 1. CLI parsing and framework detection (`bin.ts` → `src/run.ts`)

`bin.ts` parses CLI args, checks Node version, and calls `runWizard()` in `src/run.ts`. The run function detects the project framework (Next.js, React, etc.) by inspecting `package.json` and project structure, then loads the matching `FrameworkConfig` from `src/frameworks/`.

### 2. TUI startup and UI flow (`src/ui/tui/start-tui.ts`)

The TUI renders and the user progresses through screens. Screen order is driven by a `Workflow` — an ordered list of `WorkflowStep` objects defined in `src/lib/workflows/posthog-integration.ts`. Each step declares which screen it owns and when that screen is complete.

The workflow is converted to `FlowEntry[]` via `workflowToFlowEntries()` and fed to the router. The router walks the entries, skipping completed/hidden screens, and returns the first incomplete one. This is reactive — every session mutation re-resolves the active screen.

**Gate steps** block downstream code. The `intro` step has `gate: 'setup'` — `bin.ts` awaits `store.setupComplete` before proceeding. The `health-check` step has `gate: 'health'` — `bin.ts` awaits `store.healthGateComplete`.

### 3. Agent runner (`src/lib/agent-runner.ts`)

Once gates resolve, `runAgentWizard()` runs. This is where the queue takes over:

**Bootstrap query** — A standalone query tells the agent to load the skill menu, pick and install a skill, read SKILL.md, and emit the installed skill ID via `[WIZARD-SKILL-ID] <id>`. The model does NOT know about the queue — it just prepares the skill.

**SKILL.md parsing** — After bootstrap, the runner reads `.claude/skills/<id>/SKILL.md` from disk and parses the `workflow` array from its YAML frontmatter using `parseWorkflowStepsFromSkillMd()`. This produces a `WorkflowStepSeed[]` with step ids, reference filenames, and display titles.

**Queue seeding** — `createPostBootstrapQueue(steps)` builds a `WizardWorkflowQueue` from the parsed steps plus an `env-vars` step at the end. The queue is set on the store via `getUI().setWorkQueue(queue)` so the TUI can display it and dynamically enqueue new work.

**Execution loop** — The runner pops items from the queue one at a time:
```
while (queue.length > 0) {
  dequeue → setCurrentQueueItem → build prompt → runAgent → completeQueueItem
}
```

Each `runAgent` call continues the same conversation via `resumeSessionId`. The model sees one prompt per step — either "read and follow this reference file" (for workflow items) or "set up environment variables" (for env-vars). The stop hook only fires the remark/feature-queue on the last item.

### 4. TUI progress tracking

During the run, the RunScreen displays a stage-grouped progress list. Stage headers come from queue item labels (which come from SKILL.md frontmatter titles). Nested tasks come from the agent's `TodoWrite` tool calls. When the runner advances to a new queue item, `setCurrentQueueItem()` fires, the store clears the task list, and the previous item moves to the completed list.

The queue is reactive on the store — `enqueue()` and `dequeue()` trigger `emitChange()` which re-renders the UI immediately.

### 5. Post-run (`agent-runner.ts` after loop)

After the queue drains: error handling, env var upload to hosting providers, outro data construction, analytics shutdown.

## Data flow diagram

```
bin.ts
  │
  ├─ Framework detection → FrameworkConfig
  ├─ TUI startup → WizardStore + Router
  │     │
  │     └─ Workflow (WorkflowStep[])
  │           │
  │           └─ workflowToFlowEntries() → FlowEntry[] → Router (screen resolution)
  │
  ├─ await setupComplete (gate)
  ├─ await healthGateComplete (gate)
  │
  └─ runAgentWizard()
        │
        ├─ Bootstrap query → skill installed → [WIZARD-SKILL-ID]
        │
        ├─ Read SKILL.md → parseWorkflowStepsFromSkillMd() → WorkflowStepSeed[]
        │
        ├─ createPostBootstrapQueue(steps) → WizardWorkflowQueue
        │     │
        │     └─ setWorkQueue(queue) → store (reactive, UI can enqueue)
        │
        └─ while (queue.length > 0)
              │
              ├─ dequeue → setCurrentQueueItem
              ├─ buildWorkflowStepPrompt / buildEnvVarPrompt
              ├─ runAgent (continued conversation)
              └─ completeQueueItem
```

# Workflow queue

## SKILL.md frontmatter format

The skill generator in `context-mill` writes a `workflow` array into each integration skill's frontmatter:

```yaml
---
name: integration-nextjs-app-router
workflow:
  - step_id: 1.0-begin
    reference: basic-integration-1.0-begin.md
    title: PostHog Setup - Begin
    next:
      - basic-integration-1.1-edit.md
  - step_id: 1.1-edit
    reference: basic-integration-1.1-edit.md
    title: PostHog Setup - Edit
    next:
      - basic-integration-1.2-revise.md
  # ...
---
```

- `step_id` — unique identifier for the step
- `reference` — filename in the skill's `references/` directory
- `title` — human-readable label shown in the TUI progress list
- `next` — array of next step references (for future parallelization)

## Queue item types

```typescript
type WizardWorkflowQueueItem =
  | { id: 'bootstrap'; kind: 'bootstrap'; label: string }
  | { id: string; kind: 'workflow'; referenceFilename: string; label: string }
  | { id: 'env-vars'; kind: 'env-vars'; label: string };
```

## Enqueueing work dynamically

The queue is exposed to the UI via `store.workQueue`. To add work during a run:

```typescript
// Insert at front of queue (runs next)
store.workQueue.enqueueNext({
  id: 'my-task',
  kind: 'workflow',
  referenceFilename: 'my-reference.md',
  label: 'My custom step',
});

// Append to end of queue
store.workQueue.enqueue({
  id: 'my-task',
  kind: 'workflow',
  referenceFilename: 'my-reference.md',
  label: 'My custom step',
});
```

The queue is reactive — mutations trigger UI re-renders. Items enqueued while the runner loop is active will be picked up when the current step finishes.

## TUI progress display

The RunScreen shows a stage-grouped progress list:

```
☑ PostHog Setup - Begin
▶ PostHog Setup - Edit
  ☑ Add PostHog to auth.ts
  ▶ Add PostHog to checkout.ts
○ PostHog Setup - Revise
○ PostHog Setup - Conclusion
○ Environment variables
```

Stage headers come from queue item labels. Nested tasks come from the agent's `TodoWrite` calls. Tasks reset when the runner advances to a new stage.

## Defining a workflow

A workflow is an ordered list of `WorkflowStep` objects. Each step can own a screen, agent work, or both.

```typescript
// src/lib/workflow-step.ts
interface WorkflowStep {
  id: string;                                        // unique step id
  label: string;                                     // shown in progress list
  screen?: string;                                   // TUI screen (e.g. 'intro', 'run')
  show?: (session: WizardSession) => boolean;        // visibility predicate
  isComplete?: (session: WizardSession) => boolean;  // completion predicate
  gate?: 'setup' | 'health';                         // blocks downstream code
}
```

The current PostHog integration workflow is defined in `src/lib/workflows/posthog-integration.ts`:

```typescript
export const POSTHOG_INTEGRATION_WORKFLOW: Workflow = [
  { id: 'intro',   label: 'Welcome',        screen: 'intro',   gate: 'setup', isComplete: ... },
  { id: 'health',  label: 'Health check',   screen: 'health-check', gate: 'health', ... },
  { id: 'setup',   label: 'Setup',          screen: 'setup',   show: needsSetup, ... },
  { id: 'auth',    label: 'Authentication', screen: 'auth',    isComplete: ... },
  { id: 'run',     label: 'Integration',    screen: 'run',     isComplete: ... },
  { id: 'mcp',     label: 'MCP servers',    screen: 'mcp',     isComplete: ... },
  { id: 'outro',   label: 'Done',           screen: 'outro',   isComplete: ... },
  { id: 'skills',  label: 'Skills',         screen: 'skills' },
];
```

### Creating a new workflow

1. Create a new file in `src/lib/workflows/` (e.g. `feature-flags.ts`)
2. Export a `Workflow` array with your steps
3. Each step with a `screen` field needs a matching component in the screen registry
4. The flow engine converts your workflow to `FlowEntry[]` via `workflowToFlowEntries()` — the existing router handles the rest
5. Agent work steps are seeded from SKILL.md frontmatter at runtime, not from the workflow definition

### How the pieces connect

```
WorkflowStep[]  ──workflowToFlowEntries()──>  FlowEntry[]  ──>  Router (screen resolution)
                                                                      │
SKILL.md frontmatter  ──parseWorkflowStepsFromSkillMd()──>  Queue  ──>  Agent runner (per-step queries)
```

The workflow definition owns the UI flow. The SKILL.md frontmatter owns the agent work sequence. Both run during the same wizard session.

# Health checks

`src/lib/health-checks/` checks external status pages and PostHog-owned
services before the wizard runs to decide whether it can proceed. The entry
point is `evaluateWizardReadiness()`, which returns one of three values:

| Decision            | Meaning                                                         |
| ------------------- | --------------------------------------------------------------- |
| `yes`               | All services healthy — proceed normally.                        |
| `yes_with_warnings` | Some services degraded but no critical dependency is down.      |
| `no`                | A critical dependency is down or degraded — do not run.         |

### Module layout

| File | Responsibility |
| --- | --- |
| `types.ts` | Enums, interfaces (`ServiceHealthStatus`, `AllServicesHealth`, etc.) |
| `statuspage.ts` | Statuspage.io v2 API helpers + checks for Anthropic, PostHog, GitHub, npm, Cloudflare |
| `endpoints.ts` | Direct endpoint checks for LLM Gateway (`/_liveness`) and MCP (`/`) |
| `readiness.ts` | `checkAllExternalServices`, `evaluateWizardReadiness`, readiness config |
| `index.ts` | Barrel re-export |
| `testme.md` | Test running instructions and endpoint reference |

## What blocks a run

The `DEFAULT_WIZARD_READINESS_CONFIG` in `readiness.ts` controls this. It has
two arrays:

- **`downBlocksRun`** — if any of these report status **Down**, readiness is
  **No**.
- **`degradedBlocksRun`** — if any of these report **Degraded** (or worse),
  readiness is **No**.

### Current defaults

```ts
downBlocksRun: ['anthropic', 'posthogOverall', 'npmOverall', 'llmGateway', 'mcp'],
degradedBlocksRun: ['anthropic'],
```

## Smoke test helper (`scripts/smoke-test-ci.sh`)

This repo includes a helper script to run a full end‑to‑end smoke test of the wizard packaged in a tarball against a real app from [`posthog/wizard-workbench`](https://github.com/PostHog/wizard-workbench). This will catch certain packaging issues that might not be caught by other tests.

**Prerequisites**

- Point to a `wizard-workbench` checkout either by:
  - Setting `WIZARD_WORKBENCH_ROOT=/absolute/path/to/wizard-workbench`, or
  - Cloning `wizard-workbench` next to this repo (so it lives at `../wizard-workbench`).
- Set `POSTHOG_PERSONAL_API_KEY` either in your shell or in `../wizard-workbench/.env`.
- (Optional) Set `POSTHOG_PROJECT_ID` to target a specific PostHog project.

**Usage**

```bash
# Default app: next-js/15-app-router-todo
./scripts/smoke-test-ci.sh

# Specify a different app from wizard-workbench/apps
./scripts/smoke-test-ci.sh next-js/15-pages-router-saas

# With API key (and optional project ID) inline
POSTHOG_PERSONAL_API_KEY=phx_your_key_here \
POSTHOG_PROJECT_ID=12345 \
./scripts/smoke-test-ci.sh next-js/15-pages-router-saas

# Pointing at a custom wizard-workbench checkout
WIZARD_WORKBENCH_ROOT=/path/to/wizard-workbench \
./scripts/smoke-test-ci.sh
```

The script will:

- Build and pack the wizard
- Copy the selected app into a temp directory
- Install dependencies for the app
- Install the packed wizard tarball into an isolated temp project
- Run `wizard` in `--ci` mode against the copied app and perform basic post‑install checks
