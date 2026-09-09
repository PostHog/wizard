# AGENTS.md — PostHog Wizard

Instructions for all agents (and humans) working in this repo. This is the
single source of truth; [`CLAUDE.md`](CLAUDE.md) just points here. User-facing
docs: https://posthog.com/docs/ai-engineering/ai-wizard

The PostHog wizard (`npx @posthog/wizard`) is a CLI that adds PostHog to a
user's project using an AI agent. It authenticates the user, detects their
framework, runs an agent that integrates the SDK and instruments events, and
walks the user through their first dashboard. All from the terminal.

## Design discipline

This codebase follows a specific design discipline: **product knowledge never
enters infrastructure code.** The runner pipeline, the TUI store, the detection
loop, and the prompt assembler are machinery. They don't know what PostHog is.
They don't know what a framework is. They execute a pipeline driven by typed
configuration surfaces.

Each domain has a dedicated boundary:

- **Frameworks** → `FrameworkConfig` in `src/frameworks/<name>/`
- **Integration knowledge** → markdown skills in the
  [context-mill](https://github.com/PostHog/context-mill) repo
- **Security policy** → YARA-X rules in the
  [warlock](https://github.com/PostHog/warlock) sibling repo. The wizard wires
  the scanner through SDK hooks and Pi tool events; see
  [security boundaries](.claude/skills/wizard-development/references/ARCHITECTURE.md#security-boundaries).
  Gateway admission and required safety prompts live in
  [ai-gateway](https://github.com/PostHog/ai-gateway). To disable scanning in
  the field without a release, see the kill-switch runbook:
  `docs/runbooks/warlock-kill-switch.md`. ONLY USE THIS IF ABSOLUTELY NECESSARY.
- **Programs** → step arrays in `src/lib/programs/`
- **TUI** → screen components and primitives in `src/ui/tui/`

Adding a new concern means finding the narrowest existing surface, not adding
logic to the runner. Keep changes local to the boundary that owns them.

## Before making structural changes

Read [wizard-development](.claude/skills/wizard-development/SKILL.md) first. It
covers the design discipline, a decision framework for new extensions, and
warning signs that a change is drifting off-pattern. Its references extend it:

- [Architecture](.claude/skills/wizard-development/references/ARCHITECTURE.md) —
  runner, data flow, security boundaries, screen resolution
- [Anti-patterns](.claude/skills/wizard-development/references/ANTI-PATTERNS.md)
  — failure modes and alternatives
- [Maintaining skills](.claude/skills/wizard-development/references/MAINTAINING-SKILLS.md)
  — accuracy, references, and verification

## Skills available

Five skills live under `.claude/skills/`. Read `wizard-development` first for
any structural change; then load the relevant procedural skill:

| Skill                                                                        | When to use                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [wizard-development](.claude/skills/wizard-development/SKILL.md)             | Before any structural change. Design principles + decision framework.                       |
| [adding-framework-support](.claude/skills/adding-framework-support/SKILL.md) | Adding or extending a framework integration.                                                |
| [adding-skill-program](.claude/skills/adding-skill-program/SKILL.md)         | Adding a new skill-based program (e.g. a new product feature setup).                        |
| [ink-tui](.claude/skills/ink-tui/SKILL.md)                                   | Building or modifying TUI screens, layouts, and primitives.                                 |
| [exploring-the-wizard](.claude/skills/exploring-the-wizard/SKILL.md)         | Running/driving/exploring the wizard headlessly (read_state/perform_action, TUI snapshots). |

## Agent execution policy

Default new work to **Pi**, and prefer the **orchestrator** sequence. Linear
execution remains useful for very simple tasks and legacy support. The Anthropic
Agent SDK is a supported legacy fallback, deprecated as the default; retain it
for major Pi vulnerabilities or gaps in support for new Anthropic models.

This is the contribution policy, not a claim that every existing binding has
migrated: `DEFAULT_BINDING` is still Anthropic + linear. Set new bindings
explicitly and check sequence-specific hooks before migrating existing flows.
See
[execution policy and model admission](.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission)
for the gateway allowlists, required system prompt, and composition constraints.

## Coherence

[Local Coherence setup](docs/coherence.md) verifies a small set of declared
architecture contracts using source and existing tests. Run
`pnpm coherence:check` after changing its specs or their implementation. It
supplements review of the skills; it does not prove their prose or deployed
gateway policy is current.

## CLI command surface

The CLI was overhauled to a smaller, extensible command surface. **Use the new
command names.** Old names mostly no longer exist — only some are kept as
aliases.

| Old command                | New command                 | Status                                                     |
| -------------------------- | --------------------------- | ---------------------------------------------------------- |
| `wizard integrate`         | `wizard` (default flow)     | command removed                                            |
| `wizard events-audit`      | `wizard audit events`       | moved into `audit` family                                  |
| `wizard audit` (single)    | `wizard audit <subcommand>` | now a family — see [Audit subcommands](#audit-subcommands) |
| `wizard audit-3000`        | _removed_                   | retired                                                    |
| `wizard revenue`           | `wizard revenue-analytics`  | renamed (old `revenue` removed)                            |
| `wizard upload-sourcemaps` | `wizard upload-source-maps` | renamed; `upload-sourcemaps` kept as alias                 |

### Audit subcommands

`audit` is the only family with skill-backed subcommands today:

| Subcommand                    | What it audits                                       |
| ----------------------------- | ---------------------------------------------------- |
| `wizard audit events`         | event capture quality + cost (**default** leaf)      |
| `wizard audit all`            | comprehensive audit across every area                |
| `wizard audit autocapture`    | autocapture setup + cost                             |
| `wizard audit feature-flags`  | feature flag usage + cost                            |
| `wizard audit identify`       | `$identify` implementation                           |
| `wizard audit session-replay` | session replay setup                                 |
| `wizard audit web-analytics`  | web analytics setup (**wizard-native**, not a skill) |

### Commands vs. skills (the `audit [skill]` gotcha)

A skill and a command are the **same machinery** — a context-mill skill becomes
a command when its `cli:` block sets `role: command`. So `wizard audit events`
_is_ the `audit-events` skill, just promoted. `wizard skill <skill-name>`
([`skill.ts`](src/commands/skill.ts)) runs a skill that **wasn't** promoted.

Two surfaces, one mechanism. So `wizard audit <subcommand>` is choosing an audit
area — it is **not** asking for a skill name, despite `wizard audit --help`
labelling the positional `[skill]` (a wizard-internal name we left as-is). Don't
confuse it with the top-level `wizard skill` command.

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
- `posthog-integration` is a **program id, not a command**. It powers the
  default flow and is a dependency of most other programs. Do not treat it as a
  CLI command or reference it in CI as one.

### Adding a command alias (keep an old name working)

Give the `Command.name` an array of `[newName, ...legacyNames]`. yargs treats
the extra entries as aliases. See
[`src/commands/upload-sourcemaps.ts`](src/commands/upload-sourcemaps.ts).
Reserve aliases for names that external callers (users' scripts) may still use —
when the only caller is one we control, update the caller instead.

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

Choose verification for the change: check links and formatting for docs; run
`pnpm typecheck` and focused existing tests for code. Build when bundling or
runtime behavior changes. `pnpm test` already builds; avoid building twice. Use
nonmutating lint checks, and scope formatting fixes to edited files. Do not add
tests for prose, compiler-enforced shapes, or duplicated implementation. Keep
new code comments to one line; put longer explanations in linked docs.

### Local dev targets

Four things can independently point at a local server — the wizard binary,
context-mill (`:8765`), the MCP server (`:8787`), and PostHog (`:8010`). One
flag per service (`--local-context-mill`, `--local-mcp`, `--local-posthog`),
plus `--local-dev` for all three. They're dev-build-only; published builds
reject them.

Note `wizard mcp add --local` is **not** one of these — it writes a
`posthog-local` entry into your editor's MCP config, and is unrelated to where a
wizard run points. Full catalog: [`docs/local-dev.md`](docs/local-dev.md).

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
  `wizard-tools` MCP server (`check_env_keys` / `set_env_values`) for `.env`
  file operations.
- Feedback / issues: wizard@posthog.com or
  [GitHub Issues](https://github.com/posthog/wizard/issues).

## Companion projects

- **[context-mill](https://github.com/PostHog/context-mill)** — builds and
  publishes the markdown skills the wizard agent uses for framework-specific
  integration knowledge. Skills are decoupled from the wizard release cycle so
  docs and integration patterns can update independently.
- **[wizard-workbench](https://github.com/PostHog/wizard-workbench)** — the
  development and testing environment. Houses framework test apps (Next.js,
  React Router, Django, Flask, Laravel, SvelteKit, Swift, TanStack, FastAPI)
  with no PostHog installed, plus an `mprocs`-driven local dev stack that runs
  context-mill + MCP + the wizard together with hot reload. Use this to develop
  and test wizard changes against real projects.
- **[warlock](https://github.com/PostHog/warlock)** — the security scanner
  engine for PostHog's agentic flows. Bundles YARA-X rules for prompt injection,
  exfiltration, destructive operations, supply chain attacks, hardcoded secrets,
  and PII. Engine-only: it returns matches with category/severity/action
  metadata; the wizard decides how to respond. New security rules belong in
  warlock, not in the wizard.
