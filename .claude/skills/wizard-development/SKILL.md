---
name: wizard-development
description: >
  Design philosophy and architectural principles for the PostHog wizard.
  Read this before making any structural change — adding features, extending
  the runner, modifying the TUI, or introducing new abstractions. Covers
  why the architecture is shaped this way, how to evaluate whether a change
  fits, and how to extend the system into territory no existing skill covers.
  Complements the existing skills in this repo targeted at specific subsystems.
compatibility: Designed for Claude Code or similar coding agents working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "1.0"
---

# Wizard Development

This skill teaches the design discipline behind the wizard's architecture. The
procedural skills tell you *how* to add things. This skill tells you *why* the system is shaped the
way it is, so you can make good decisions when extending into territory no
existing skill covers.

Read this first. Then any procedural skill that's relevant for what you're building.

## The core discipline

Every architectural decision in this codebase is guided by one question:

> **Who will need to change this next, and what's the smallest thing they
> should have to understand?**

This question produces a specific, testable commitment: **product knowledge
never enters infrastructure code.** The runner pipeline, the TUI store, the
detection loop, the prompt assembler — these are machinery. They don't know
what PostHog is. They don't know what a framework is. They execute a pipeline
driven by configuration.

The knowledge — what PostHog needs from a Next.js project, how to detect
SvelteKit, what security rules to enforce — lives in configuration surfaces
with typed boundaries:

| Which domain has leverage | Where it lives | What they need to understand |
|---|---|---|
| Frameworks | `FrameworkConfig` (~70-120 lines) | Detection, env vars, prompts |
| Docs | Skill markdown in context-mill | Workflow steps, example code |
| Security | YARA rules in `yara-scanner.ts` | Regex patterns, severity levels |
| Context | Step array in `workflows/` | Gates, screens, predicates |
| UI | Screen component + primitives | Ink, store getters, layout |
| Agent development | Runner, store, detection loop, tools | The machinery itself |

These tight boundaries increase the scope of who is able to contribute to the wizard, while lowering the costs of those contributions. PostHog has a variety of skillsets across many kinds of teams. The wizard should be as accessible to contributions as possible to as many contributor skill sets as possible.

## The five principles

### 1. Route to the narrowest configuration surface

When a new concern arises, find the narrowest typed boundary where it belongs.
Don't add it to the runner. Don't add it to the store. Don't create a new
abstraction. Find the existing configuration surface — or, if truly needed,
create a new one that follows the same pattern.

**The test:** Can someone modify this concern without reading the agent runner?

**What goes wrong when violated:** Product-specific logic gets inlined into
infrastructure files. The runner grows from hundreds of lines to thousands.
Changes in one product domain risk breaking another. Contributors need to
understand the full system to make local changes. Recovery infrastructure
proliferates to handle the unpredictable interactions between concerns that
should have been separated.

### 2. Knowledge lives in markdown, not code

The agent's behavior is shaped by skill content and commandments, not by
conditional logic in the runner. Framework-specific integration knowledge is
authored as static markdown artifacts — reviewed, tested, versioned, and
delivered separately from the engine via the context-mill repo.

This separation exists because PostHog's product surface is vast (analytics,
session replay, feature flags, experiments, surveys, error tracking, LLM
analytics, revenue analytics, data warehouse). Each domain has its own SDK
patterns and its own update cadence. If integration knowledge lived in wizard
code, every docs update would require a wizard release.

**The test:** Can the docs team update integration instructions without a
wizard code change? Is the prompt assembler under 70 lines?

**What goes wrong when violated:** The prompt builder accumulates
framework-specific conditionals. The commandments grow from terse rules into
paragraph-length tutorials. Knowledge that changes at docs-team cadence gets
locked to wizard release cadence. The system prompt bloats, consuming context
window that the agent needs for actual work.

### 3. Prevent rather than recover

Invest in making the agent go right rather than building recovery
infrastructure for when it goes wrong. Prevention at the boundary is cheaper
and more reliable than detection-and-repair after the fact.

Three prevention layers:

- **L0 — Commandments** (`commandments.ts`): Terse rules in the system prompt.
  Keep these short. If a rule needs a paragraph of explanation, it belongs in
  a skill reference file, not in the per-turn system prompt.

- **L1 — canUseTool allowlist** (`agent-interface.ts`): Blocks dangerous bash
  commands before execution. The `wizard-tools` MCP fences `.env` files so the
  agent never sees secret values.

- **L2 — YARA scanner** (`yara-scanner.ts` + `yara-hooks.ts`): Regex rules
  running as pre/post tool-use hooks. Catches PII in capture calls, hardcoded
  keys, prompt injection, secret exfiltration, supply chain attacks. Critical
  violations terminate the session. **Fails closed** — scanner error means
  block, not pass.

**The test:** When the agent misbehaves, does the system prevent the damage or
detect it afterward? Does the system fail closed on uncertainty?

**What goes wrong when violated:** You build circuit breakers, checkpoints,
retry-from-checkpoint, self-heal logic, graceful-exit handling. Each of these
is code that exists because the boundary didn't prevent the problem. The
codebase grows to compensate for the absence of prevention, and the recovery
code itself becomes a source of complexity and bugs.

### 4. New capability is a new workflow, not a new branch

When the product needs a new capability (revenue analytics, audit, LLM
analytics), express it as a new workflow — a separate step array with its own
config — not as conditional logic in the existing runner.

`WorkflowConfig` is a uniform type. The workflow registry is an array. CLI
subcommands, TUI flows, and the router all derive from the registry
automatically. Adding a workflow means:

1. Create `src/lib/workflows/<name>/` with `index.ts` exporting a `WorkflowConfig`
2. Add it to `WORKFLOW_REGISTRY` in `workflow-registry.ts`
3. Add a `Flow` enum entry in `flows.ts`

No changes to `bin.ts`, the store, or the runner.

**The test:** Can a new workflow ship without modifying the runner, the store,
or `bin.ts`?

**What goes wrong when violated:** The runner becomes a monolithic function
with product-specific branches. Each new capability increases the blast radius
of every other capability's changes. The function grows past the point where
anyone can hold it in their head.

### 5. The UI is a pure function of state

The screen the user sees is computed from `WizardSession` — the single source
of truth. No component sets its own visibility. No code imperatively navigates.
The router walks the workflow's step list and returns the first step whose
`isComplete` predicate is still false.

Every session mutation goes through an explicit store setter that calls
`emitChange()`. The version counter bumps. Gate predicates are re-evaluated.
Screen transitions are detected. React re-renders.

**The test:** Can you predict which screen is active by reading only the
session state? Is there any imperative navigation (`goTo`, `push`, `navigate`)
in the codebase?

**What goes wrong when violated:** The UI can reach states that don't
correspond to any valid session. Screens get stuck. Flows advance when they
shouldn't. Contributors add imperative transitions to "fix" rendering bugs
that are actually state bugs, creating a tangle of navigation logic that
obscures the real control flow.

## Extending into new territory

The five principles above cover the existing patterns. But the wizard will need
capabilities that don't fit neatly into any current configuration surface.
Here's how to evaluate new extensions:

### Decision framework

When you're adding something that doesn't have a precedent in the codebase,
ask these questions in order:

1. **Which domain does this belong to?** If it's framework-specific, it goes
   in `FrameworkConfig`. If it's integration knowledge, it goes in skill
   content. If it's a security constraint, it goes in YARA rules. If you
   can't name a specific domain from the table above, the concern may not
   be well-defined yet.

2. **Does this change at a different rate than the code around it?** Knowledge
   that updates weekly shouldn't live in code that releases monthly. If the
   concern changes faster than its container, it needs a decoupled delivery
   mechanism (like context-mill skills). If it changes slower, it can live in
   code.

3. **Can I express this as configuration rather than logic?** A typed
   interface with six fields is better than a function with six conditionals.
   The interface is documentation. The conditionals are implementation detail
   that future readers must reverse-engineer.

4. **What happens if this concern is wrong?** If a wrong value causes a bad
   user experience, the boundary should provide fast feedback (compiler error,
   test failure). If a wrong value causes a security incident, the boundary
   should prevent execution (YARA, canUseTool). Match the severity of failure
   to the strength of the boundary.

5. **Does this expand the required knowledge for a domain?** If adding this
   feature means working on frameworks now requires understanding the TUI,
   or working on security now requires understanding the runner, the
   boundary is in the wrong place. Refactor until the required knowledge
   for each domain stays within its column.

### Patterns for common extension types

**New agent tool (in-process MCP):**
Add it to `wizard-tools.ts` alongside `check_env_keys`, `set_env_values`, etc.
The tool runs locally — secret values never leave the machine. Register the
tool name in `WIZARD_TOOL_NAMES` so the SDK allowlist includes it. Follow the
existing tool pattern: zod schema, path-traversal protection, logging.

**New security rule:**
Add a `YaraRule` object to the `RULES` array in `yara-scanner.ts`. Each rule
has a name, description, severity, category, `appliesTo` (which hook+tool
combinations), and `patterns` (compiled regex). One match per rule is
sufficient. The hooks in `yara-hooks.ts` don't need to change — they iterate
the rules array automatically.

**New detection signal:**
If you need to detect something about the project beyond framework identity
(e.g., Stripe presence, LLM SDK usage), add it to `detection/features.ts`.
The `discoverFeatures()` function returns an array of `DiscoveredFeature`
enums. The intro screen and workflow can read discovered features from the
session. Detection functions are pure — no store mutations, no UI calls.

**New middleware:**
Implement the `Middleware` interface from `middleware/types.ts`: a `name` and
optional lifecycle hooks (`onInit`, `onMessage`, `onPhaseTransition`,
`onFinalize`). Add it to the pipeline construction in `agent-runner.ts`. The
pipeline dispatches to middlewares in order. Each middleware publishes to a
shared store that downstream middleware can read. The pipeline itself doesn't
change shape.

**New TUI primitive:**
Create the component in `src/ui/tui/primitives/`. Export from
`primitives/index.ts`. Primitives are pure rendering — they take props and
return Ink JSX. They don't import the store, don't call `getUI()`, don't
mutate state. Screens compose primitives; primitives don't know what screen
they're in. See the `ink-tui` skill for the full component catalog and layout
patterns.

**New post-agent step:**
If you need to do something after the agent completes (upload env vars, install
MCP servers, etc.), use the `postRun` hook on `WorkflowRun`. The hook receives
the session and credentials. It runs after the agent succeeds but before the
outro. It doesn't modify the runner pipeline — it's a callback on the workflow
configuration.

**New environment variable convention:**
Each framework's `FrameworkConfig.environment.getEnvVars()` returns the env var
names and values. The naming convention is framework-specific (e.g.,
`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` for Next.js, `PUBLIC_POSTHOG_PROJECT_TOKEN`
for SvelteKit). If you need a new convention, add it to the framework config.
The runner doesn't know or care what the env vars are called.

## What to watch for

These are the early warning signs that a change is drifting from the
discipline:

- **The runner is getting longer.** If you're adding lines to
  `agent-runner.ts` or `agent-interface.ts`, ask whether the concern belongs
  in a `WorkflowRun` config, a middleware, a post-run hook, or a skill file.

- **A framework contributor needs to read the runner.** The `FrameworkConfig`
  interface should be sufficient. If it's not, the interface is missing a
  field — extend the interface, don't add special-case logic to the runner.

- **The commandments are getting long.** Commandments are per-turn system
  prompt — every token counts. If a rule needs explanation, move the
  explanation to a skill reference file and leave only the invariant in the
  commandment.

- **You're building recovery infrastructure.** If you're writing retry logic,
  checkpoint saving, or self-heal code, ask whether a prevention layer
  (YARA rule, canUseTool rule, skill content improvement) would eliminate the
  failure mode instead of recovering from it.

- **You're adding imperative UI transitions.** If you're writing `goTo`,
  `navigate`, or `if (screen === X) show Y`, the session state doesn't
  accurately represent what the user should see. Fix the state model and let
  the router derive the screen.

- **A change in one workflow breaks another.** Workflows should be
  independent. If they share mutable state beyond the session, that state
  needs an explicit boundary (a store setter, a workflow config field) instead
  of implicit coupling through the runner.

## Compactness is an indicator, not a goal

The wizard is ~20K lines of source. This isn't minimalism for its own sake.
It's a side effect of routing each concern to the right configuration surface.

When concerns are correctly separated, each change is local. Defensive code is
unnecessary because boundaries prevent damage from propagating. The codebase
stays small because it doesn't need recovery infrastructure, special-case
branches, or coordination code between concerns that shouldn't know about each
other.

If the codebase is growing faster than the capability it delivers, the
boundaries are in the wrong place. Measure the ratio, not the absolute size.

## Reference files

- [references/ARCHITECTURE.md](references/ARCHITECTURE.md) — Pipeline anatomy, data flow, security boundaries, screen resolution, MCP topology, middleware pipeline. **Read when you need to understand where a new concern hooks in.**
- [references/ANTI-PATTERNS.md](references/ANTI-PATTERNS.md) — Concrete failure modes with alternatives: inlining product logic, bloating commandments, building recovery instead of prevention, imperative navigation, bundling mismatched-rate knowledge. **Read when evaluating whether a proposed change fits.**
