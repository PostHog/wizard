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

This skill teaches the design discipline behind the wizard's architecture. The procedural skills tell you *how* to add things. This skill tells you *why* the system is shaped the way it is, so you can make good decisions when extending into territory no existing skill covers.

Read this first. Then any procedural skill that's relevant for what you're building.

## The core discipline

Every architectural decision in this codebase is guided by one question:

> **Who will need to change this next, and what's the smallest thing they
> should have to understand?**

This question produces a specific, testable commitment: **product knowledge never enters infrastructure code.** The runner pipeline, the TUI store, the detection loop, the prompt assembler — these are machinery. They don't know what PostHog is. They don't know what a framework is. They execute a pipeline driven by configuration.

The knowledge — what PostHog needs from a Next.js project, how to detect SvelteKit, what security rules to enforce — lives in configuration surfaces with typed boundaries:

| Which domain has leverage | Where it lives | What they need to understand |
|---|---|---|
| Frameworks | `FrameworkConfig` (~70-120 lines) | Detection, env vars, prompts |
| Docs | Skill markdown in context-mill | Workflow steps, example code |
| Security | YARA-X rules in the [warlock](https://github.com/PostHog/warlock) sibling repo | Rule content (patterns, severity, category). Wizard wires the engine via hooks. |
| Context | Step array in `programs/` | Gates, screens, predicates |
| UI | Screen component + primitives | Ink, store getters, layout |
| Agent development | Runner, store, detection loop, tools | The machinery itself |

These tight boundaries increase the scope of who is able to contribute to the wizard, while lowering the costs of those contributions. PostHog has a variety of skillsets across many kinds of teams. The wizard should be as accessible to contributions as possible to as many contributor skill sets as possible.

## The five principles

### 1. Route to the narrowest configuration surface

When a new concern arises, find the narrowest typed boundary where it belongs. Don't add it to the runner. Don't add it to the store. Don't create a new abstraction. Find the existing configuration surface — or, if truly needed, create a new one that follows the same pattern.

**The test:** Can someone modify this concern without reading the agent runner?

**What goes wrong when violated:** Product-specific logic gets inlined into infrastructure files. The runner grows from hundreds of lines to thousands. Changes in one product domain risk breaking another. Contributors need to understand the full system to make local changes. Recovery infrastructure proliferates to handle the unpredictable interactions between concerns that should have been separated.

### 2. Knowledge lives in markdown, not code

The agent's behavior is shaped by skill content and commandments, not by conditional logic in the runner. Framework-specific integration knowledge is authored as static markdown artifacts — reviewed, tested, versioned, and delivered separately from the engine via the context-mill repo.

This separation exists because PostHog's product surface is vast (analytics, session replay, feature flags, experiments, surveys, error tracking, LLM analytics, revenue analytics, data warehouse). Each domain has its own SDK patterns and its own update cadence. If integration knowledge lived in wizard code, every docs update would require a wizard release.

**The test:** Can the docs team update integration instructions without a wizard code change? Is the prompt assembler under 70 lines?

**What goes wrong when violated:** The prompt builder accumulates framework-specific conditionals. The commandments grow from terse rules into paragraph-length tutorials. Knowledge that changes at docs-team cadence gets locked to wizard release cadence. The system prompt bloats, consuming context window that the agent needs for actual work.

### 3. Prevent rather than recover

Invest in making the agent go right rather than building recovery infrastructure for when it goes wrong. Prevention at the boundary is cheaper and more reliable than detection-and-repair after the fact.

Three prevention layers:

- **L0 — Commandments** (`commandments.ts`): Terse rules in the system prompt. Keep these short. If a rule needs a paragraph of explanation, it belongs in a skill reference file, not in the per-turn system prompt.

- **L1 — canUseTool allowlist** (`agent-interface.ts`): Blocks dangerous bash commands before execution. The `wizard-tools` MCP fences `.env` files so the agent can't read them directly. Secrets the user supplies are handled separately by the **session secret vault** (`secret-vault.ts`): `wizard_ask` and `set_env_values` exchange the raw value for an opaque `secret:<uuid>` ref, so a user's API key reaches the `.env` file without ever entering the LLM conversation. See [ARCHITECTURE.md](references/ARCHITECTURE.md#secret-vault-keeping-values-out-of-the-model).

- **L2 — warlock scanner** (rules live in [warlock](https://github.com/PostHog/warlock); wizard wires hooks in `yara-hooks.ts`): Real YARA-X rules running as pre/post tool-use hooks. Catches PII in capture calls, hardcoded keys, prompt injection, secret exfiltration, supply chain attacks, destructive operations. The scanner is engine-only — it returns matches with category/severity/action metadata; the wizard decides how to respond. Critical violations terminate the session. **Fails closed** — scanner error means block, not pass. (Note: the wizard still ships a legacy hand-rolled regex scanner at `src/lib/yara-scanner.ts` during the warlock migration. New rules go in warlock; the in-repo scanner is being retired.)

**The test:** When the agent misbehaves, does the system prevent the damage or detect it afterward? Does the system fail closed on uncertainty?

**What goes wrong when violated:** You build circuit breakers, checkpoints, retry-from-checkpoint, self-heal logic, graceful-exit handling. Each of these is code that exists because the boundary didn't prevent the problem. The codebase grows to compensate for the absence of prevention, and the recovery code itself becomes a source of complexity and bugs.

### 4. New capability is a new program, not a new branch

When the product needs a new capability (revenue analytics, audit, LLM analytics), express it as a new program — a separate step array with its own config — not as conditional logic in the existing runner.

`ProgramConfig` is a uniform type. CLI registration goes through one of two factories: `nativeCommandFactory(config)` for wizard-native commands, or `skillCommandFactory(entry, config)` for skill-backed commands (which derives the public surface from context-mill's `cli-manifest.json` — snapshotted at build time into `src/lib/programs/cli-manifest.generated.ts`). Screen sequences, the router, and the store all derive from the registry automatically.

**Adding a new public skill-backed command is usually a context-mill PR, not a wizard PR.** Set `cli: { surface: public, command: <name> }` on the skill's `config.yaml`; the wizard's next release picks it up via the manifest. A wizard PR is only needed when the program also wants custom hooks (outro, abort cases, content blocks) — in which case you add a `ProgramConfig` and the per-family command file dispatches through it.

For wizard-native programs (doctor, mcp, source-maps, the default integration), the path is:

1. Create `src/lib/programs/<name>/` with `index.ts` exporting a `ProgramConfig`
2. Add it to `PROGRAM_REGISTRY` in `program-registry.ts`
3. Register it in `bin.ts` with `nativeCommandFactory(yourConfig)`

For families with no-leaf interactive pickers (`wizard audit`), the parent command sets `interactiveDefault: createFamilyPickerDefault(label, children)`. See `src/commands/audit.ts`.

**The test:** Can a new program ship without modifying the agent runner pipeline (`agent-runner.ts`), the store, or the screen-sequences projection?

**What goes wrong when violated:** The runner becomes a monolithic function with product-specific branches. Each new capability increases the blast radius of every other capability's changes. The function grows past the point where anyone can hold it in their head.

### 5. The UI is a pure function of state

The screen the user sees is computed from `WizardSession` — the single source of truth. No component sets its own visibility. No code imperatively navigates. The router walks the program's step list and returns the first step whose `isComplete` predicate is still false.

Every session mutation goes through an explicit store setter that calls `emitChange()`. The version counter bumps. Gate predicates are re-evaluated. Screen transitions are detected. React re-renders.

**The test:** Can you predict which screen is active by reading only the session state? Is there any imperative navigation (`goTo`, `push`, `navigate`) in the codebase?

**What goes wrong when violated:** The UI can reach states that don't correspond to any valid session. Screens get stuck. Flows advance when they shouldn't. Contributors add imperative transitions to "fix" rendering bugs that are actually state bugs, creating a tangle of navigation logic that obscures the real control flow.

## Extending into new territory

The five principles above cover the existing patterns. But the wizard will need capabilities that don't fit neatly into any current configuration surface. Here's how to evaluate new extensions:

### Decision framework

When you're adding something that doesn't have a precedent in the codebase, ask these questions in order:

1. **Which domain does this belong to?** If it's framework-specific, it goes in `FrameworkConfig`. If it's integration knowledge, it goes in skill content. If it's a security constraint, it goes in a warlock rule (the sibling repo). If you can't name a specific domain from the table above, the concern may not be well-defined yet.

2. **Does this change at a different rate than the code around it?** Knowledge that updates weekly shouldn't live in code that releases monthly. If the concern changes faster than its container, it needs a decoupled delivery mechanism (like context-mill skills). If it changes slower, it can live in code.

3. **Can I express this as configuration rather than logic?** A typed interface with six fields is better than a function with six conditionals. The interface is documentation. The conditionals are implementation detail that future readers must reverse-engineer.

4. **What happens if this concern is wrong?** If a wrong value causes a bad user experience, the boundary should provide fast feedback (compiler error, test failure). If a wrong value causes a security incident, the boundary should prevent execution (YARA, canUseTool). Match the severity of failure to the strength of the boundary.

5. **Does this expand the required knowledge for a domain?** If adding this feature means working on frameworks now requires understanding the TUI, or working on security now requires understanding the runner, the boundary is in the wrong place. Refactor until the required knowledge for each domain stays within its column.

### Patterns for common extension types

**New agent tool (in-process MCP):** Add it to `wizard-tools.ts` alongside `check_env_keys`, `set_env_values`, etc. The tool runs locally — secret values never leave the machine. Register the tool name in `WIZARD_TOOL_NAMES` so the SDK allowlist includes it. Follow the existing tool pattern: zod schema, path-traversal protection, logging. If the tool handles a user secret, route it through the secret vault (`secret-vault.ts`) — return a `secret:<uuid>` ref, not the value, and resolve it host-side at the point of use — so the secret stays out of the LLM conversation.

**New security rule:** Contribute the rule to [warlock](https://github.com/PostHog/warlock), not to the wizard. Warlock is the YARA-X engine that backs the wizard's security scanning; it's an append-only sibling repo with its own contribution process. Add a `.yar` file under `src/scanner/rules/` with a meta block (description, severity, category, scan_context, action) and a test under `src/scanner/__tests__/rules/`. The wizard's hooks in `yara-hooks.ts` automatically pick up new rules when it bumps its warlock dependency — wizard-side changes are unnecessary unless the response to a new category needs different handling. Filter consumed matches by `category` and `severity` (the append-only API contract), not by individual rule names.

**New detection signal:** If you need to detect something about the project beyond framework identity (e.g., Stripe presence, LLM SDK usage), add it to `detection/features.ts`. The `discoverFeatures()` function returns an array of `DiscoveredFeature` enums. The intro screen and program can read discovered features from the session. Detection functions are pure — no store mutations, no UI calls.

**New middleware:** Implement the `Middleware` interface from `middleware/types.ts`: a `name` and optional lifecycle hooks (`onInit`, `onMessage`, `onPhaseTransition`, `onFinalize`). Add it to the pipeline construction in `agent-runner.ts`. The pipeline dispatches to middlewares in order. Each middleware publishes to a shared store that downstream middleware can read. The pipeline itself doesn't change shape.

**New TUI primitive:** Create the component in `src/ui/tui/primitives/`. Export from `primitives/index.ts`. Primitives are pure rendering — they take props and return Ink JSX. They don't import the store, don't call `getUI()`, don't mutate state. Screens compose primitives; primitives don't know what screen they're in. **Add a demo under `src/ui/tui/playground/demos/` and register it in `PlaygroundApp.tsx`** — primitives that aren't in the playground are invisible to future contributors, who will build duplicates instead of reusing yours. See the `ink-tui` skill for the full component catalog and layout patterns.

**New post-agent step:** If you need to do something after the agent completes (upload env vars, install MCP servers, etc.), use the `postRun` hook on `ProgramRun`. The hook receives the session and credentials. It runs after the agent succeeds but before the outro. It doesn't modify the runner pipeline — it's a callback on the program configuration.

**Custom program outro:** Set `buildOutroData` on the `ProgramRun`. The function receives the session, credentials, and cloud region; returns an `OutroData` object that drives the outro screen. Use this for program-specific success messages, change lists, dashboard URLs, or seasonal copy. The runner uses sensible defaults from `successMessage`/`reportFile`/`docsUrl` when `buildOutroData` is omitted.

**New environment variable convention:** Each framework's `FrameworkConfig.environment.getEnvVars()` returns the env var names and values. The naming convention is framework-specific (e.g., `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` for Next.js, `PUBLIC_POSTHOG_PROJECT_TOKEN` for SvelteKit). If you need a new convention, add it to the framework config. The runner doesn't know or care what the env vars are called.

## Tests

Tests use vitest and live in `__tests__/` directories adjacent to the source they cover. The architecture is test-friendly because most hot zones are pure functions: router resolution, gate predicates, detection logic, prompt assembly, hook wiring, factory output. Test these directly — no mocking, no fixtures. (Security rule matching is tested in the warlock repo, not here.)

What to test when extending the system:

- **New factory or typed interface:** add contract tests in a sibling `__tests__/` that lock down shape and defaults. Future readers (and future skill writers) lean on these as the durable record of what the abstraction guarantees.
- **New gate or `isComplete` predicate:** test the predicate as a pure function with mutated `buildSession({})` results. Don't try to integration-test the router around it.
- **New warlock rule:** tests live alongside the rule in the warlock repo (`src/scanner/__tests__/rules/`). Cover at least one matching string and one near-miss to catch over-matching. The wizard doesn't need tests for rules it merely consumes.
- **New detection function:** test against fixture inputs (parsed `package.json` shapes, file contents). Detection is pure — no install dir mocking needed if you call the parser directly.

What NOT to test:

- The agent run itself, the SDK call, real network calls. These are integration concerns; the unit boundary stops at "the configuration the runner consumes is correct."
- The TUI's full render output. Test screen resolution (router predicates) and store setters; trust Ink to render.
- Things the type system already guarantees. If the compiler catches it, a test for it is redundant.

Verify your changes with `pnpm build && pnpm test && pnpm fix` before finishing. If you can't write a clean test for what you're adding, that's often a signal that the boundary is in the wrong place.

## What to watch for

These are the early warning signs that a change is drifting from the discipline:

- **The runner is getting longer.** If you're adding lines to `agent-runner.ts` or `agent-interface.ts`, ask whether the concern belongs in a `ProgramRun` config, a middleware, a post-run hook, or a skill file.

- **A framework contributor needs to read the runner.** The `FrameworkConfig` interface should be sufficient. If it's not, the interface is missing a field — extend the interface, don't add special-case logic to the runner.

- **The commandments are getting long.** Commandments are per-turn system prompt — every token counts. If a rule needs explanation, move the explanation to a skill reference file and leave only the invariant in the commandment.

- **You're building recovery infrastructure.** If you're writing retry logic, checkpoint saving, or self-heal code, ask whether a prevention layer (warlock rule, canUseTool rule, skill content improvement) would eliminate the failure mode instead of recovering from it.

- **You're adding imperative UI transitions.** If you're writing `goTo`, `navigate`, or `if (screen === X) show Y`, the session state doesn't accurately represent what the user should see. Fix the state model and let the router derive the screen.

- **A change in one program breaks another.** Programs should be independent. If they share mutable state beyond the session, that state needs an explicit boundary (a store setter, a program config field) instead of implicit coupling through the runner.

## Compactness is an indicator, not a goal

The wizard is ~20K lines of source. This isn't minimalism for its own sake. It's a side effect of routing each concern to the right configuration surface.

When concerns are correctly separated, each change is local. Defensive code is unnecessary because boundaries prevent damage from propagating. The codebase stays small because it doesn't need recovery infrastructure, special-case branches, or coordination code between concerns that shouldn't know about each other.

If the codebase is growing faster than the capability it delivers, the boundaries are in the wrong place. Measure the ratio, not the absolute size.

## Reference files

- [references/ARCHITECTURE.md](references/ARCHITECTURE.md) — Pipeline anatomy, data flow, security boundaries, screen resolution, MCP topology, middleware pipeline. **Read when you need to understand where a new concern hooks in.**
- [references/ANTI-PATTERNS.md](references/ANTI-PATTERNS.md) — Concrete failure modes with alternatives: inlining product logic, bloating commandments, building recovery instead of prevention, imperative navigation, bundling mismatched-rate knowledge. **Read when evaluating whether a proposed change fits.**
- [references/MAINTAINING-SKILLS.md](references/MAINTAINING-SKILLS.md) — How to keep the skills under `.claude/skills/` accurate over time: drift sources, review checklist, review triggers, patterns that age well, the deletion question, versioning convention. **Read when making any major architecture change in this repo.**

