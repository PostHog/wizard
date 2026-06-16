# AGENTS.md — PostHog Wizard

Instructions for all agents (and humans) working in this repo. This is the
single source of truth; [`CLAUDE.md`](CLAUDE.md) just points here. User-facing
docs: https://posthog.com/docs/ai-engineering/ai-wizard

The PostHog wizard (`npx @posthog/wizard`) is a CLI that adds PostHog to a user's project using an AI agent. It authenticates the user, detects their framework, runs an agent that integrates the SDK and instruments events, and walks the user through their first dashboard. All from the terminal.

## Design discipline

This codebase follows a specific design discipline: **product knowledge never enters infrastructure code.** The runner pipeline, the TUI store, the detection loop, and the prompt assembler are machinery. They don't know what PostHog is. They don't know what a framework is. They execute a pipeline driven by typed configuration surfaces.

Each domain has a dedicated boundary:

- **Frameworks** → `FrameworkConfig` in `src/frameworks/<name>/`
- **Integration knowledge** → markdown skills in the
[context-mill](https://github.com/PostHog/context-mill) repo
- **Security policy** → YARA-X rules in the [warlock](https://github.com/PostHog/warlock) sibling repo. The wizard wires the scanner via PostToolUse/PreToolUse hooks (`src/lib/yara-hooks.ts`); the rule content itself lives in warlock.
- **Programs** → step arrays in `src/lib/programs/`
- **TUI** → screen components and primitives in `src/ui/tui/`

Adding a new concern means finding the narrowest existing surface, not adding logic to the runner. The wizard is small (~20K lines) because boundaries prevent damage from propagating between concerns.

## Before making structural changes

Read `.claude/skills/wizard-development/SKILL.md` first. It covers the design discipline, a decision framework for new extensions, and warning signs that a change is drifting off-pattern. Two reference files extend it:

- `references/ARCHITECTURE.md` — pipeline anatomy, data flow, security
boundaries, screen resolution
- `references/ANTI-PATTERNS.md` — concrete failure modes with alternatives

## Skills available

Four skills live under `.claude/skills/`. Read `wizard-development` first for any structural change; then load the relevant procedural skill:

| Skill | When to use |
|---|---|
| `wizard-development` | Before any structural change. Design principles + decision framework. |
| `adding-framework-support` | Adding a new framework integration (e.g. Ruby on Rails, Go, Angular). |
| `adding-skill-program` | Adding a new skill-based program (e.g. a new product feature setup). |
| `ink-tui` | Building or modifying TUI screens, layouts, and primitives. |

## CLI command surface

The CLI was overhauled to a smaller, extensible command surface. **Use the new
command names.** Old names mostly no longer exist — only some are kept as aliases.

| Old command | New command | Status |
|---|---|---|
| `wizard integrate` | `wizard` (default flow) | command removed |
| `wizard events-audit` | `wizard audit events` | moved into `audit` family |
| `wizard audit` (single) | `wizard audit [skill]` | now a family; `audit all` = comprehensive |
| `wizard audit-3000` | *removed* | retired |
| `wizard revenue` | `wizard revenue-analytics` | renamed (old `revenue` removed) |
| `wizard upload-sourcemaps` | `wizard upload-source-maps` | renamed; `upload-sourcemaps` kept as alias |

### Where the surface is defined (source of truth)

- **Registration:** [`bin.ts`](bin.ts) — the `.use()` chain wires each command.
- **Command shape:** [`src/commands/command.ts`](src/commands/command.ts) — the
  `Command` interface every command implements.
- **Flat native commands** (e.g. `revenue-analytics`, `upload-source-maps`) are
  built with `nativeCommandFactory`
  ([`src/commands/factories/native-command-factory.ts`](src/commands/factories/native-command-factory.ts)).
- **Family commands** (e.g. `audit`) resolve subcommands at runtime against the
  `cliEntries` in `skill-menu.json`. Logic lives in
  [`src/lib/programs/dispatch-family.ts`](src/lib/programs/dispatch-family.ts).
  Adding a skill-backed subcommand is a **context-mill** release, not a wizard
  change.

### Commands vs. programs (don't confuse these)

- A **command** is the word a user types (`audit`, `revenue-analytics`).
- A **program** is the internal business logic (`posthog-integration`,
  `revenue-analytics-setup`) that a command invokes, and that other programs
  depend on via `requires: [...]`.
- `posthog-integration` is a **program id, not a command**. It powers the default
  flow and is a dependency of most other programs. Do not treat it as a CLI
  command or reference it in CI as one.

### Adding a command alias (keep an old name working)

Give the `Command.name` an array of `[newName, ...legacyNames]`. yargs treats the
extra entries as aliases. See
[`src/commands/upload-sourcemaps.ts`](src/commands/upload-sourcemaps.ts). Reserve
aliases for names that external callers (users' scripts) may still use — when the
only caller is one we control, update the caller instead.

## Commands

```bash
pnpm install                       # Install dependencies
pnpm try --install-dir=<path>      # Run the wizard locally against a test project
pnpm build                         # Compile TypeScript
pnpm test                          # Unit tests (builds first)
pnpm test:watch                    # Unit tests in watch mode
pnpm test:e2e                      # End-to-end tests
pnpm lint                          # Prettier + ESLint checks
pnpm fix                           # Auto-fix lint issues
pnpm dev                           # Build, link globally, watch for changes
```

After any change, verify with:

```bash
pnpm build && pnpm test && pnpm fix
```

## Repository conventions

- TypeScript everywhere. Use `type` (not `interface`) for framework context
types so they satisfy `Record<string, unknown>`.
- All UI calls go through `getUI()` (returns `WizardUI` interface). Never import
the store directly from business logic.
- Session mutations go through explicit store setters that call `emitChange()`.
Never mutate `session` directly — nanostore holds a shallow copy.
- The router resolves the active screen from session state. No imperative
navigation (`goTo`, `navigate`, `push`) anywhere.
- Never write secrets to source code or hardcode API keys. Use the
`wizard-tools` MCP server (`check_env_keys` / `set_env_values`) for `.env` file operations.
- Feedback / issues: wizard@posthog.com or
[GitHub Issues](https://github.com/posthog/wizard/issues).

## Companion projects

- **[context-mill](https://github.com/PostHog/context-mill)** — builds and
publishes the markdown skills the wizard agent uses for framework-specific integration knowledge. Skills are decoupled from the wizard release cycle so docs and integration patterns can update independently.
- **[wizard-workbench](https://github.com/PostHog/wizard-workbench)** — the
development and testing environment. Houses framework test apps (Next.js, React Router, Django, Flask, Laravel, SvelteKit, Swift, TanStack, FastAPI) with no PostHog installed, plus an `mprocs`-driven local dev stack that runs context-mill + MCP + the wizard together with hot reload. Use this to develop and test wizard changes against real projects.
- **[warlock](https://github.com/PostHog/warlock)** — the security scanner engine for PostHog's agentic flows. Bundles YARA-X rules for prompt injection, exfiltration, destructive operations, supply chain attacks, hardcoded secrets, and PII. Engine-only: it returns matches with category/severity/action metadata; the wizard decides how to respond. New security rules belong in warlock, not in the wizard.
