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

- **Frameworks** → `FrameworkConfig` in `src/programs/frameworks/<name>/`
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
- **Agent** → `src/agent/`. Layer source outside it imports it only through
  `@agent` (values) and `@agent/types` (types); see
  [src/agent/README.md](src/agent/README.md)
- **Shared** → `src/shared/`, library code with no upward imports. It also holds
  process-global state: the log file, the analytics client, the exit cleanup
  list and the process's one OAuth login session (`@shared/oauth-session`); see
  [src/shared/README.md](src/shared/README.md)
- **Host** → `src/host/` (`@host/*`), how the hosts end a run: `startHostExit`,
  `wizardAbort` and `registerShutdown`. Every `wizardAbort` call passes the
  presenter that shows its outro. A host resolves an exit code and only the CLI
  calls `process.exit`. It imports env and shared only. Headless, the TUI, the
  CLI and the e2e harness may import it. The agent and the programs may not; see
  [src/host/README.md](src/host/README.md)
- **Programs** → one folder per program in `src/programs/<id>/`, which other
  layer source enters only through its `index.ts`, plus `runProgram`. A program
  is an agent run; see [src/programs/README.md](src/programs/README.md) and the
  [developer interfaces](docs/developer-interfaces.md)
- **Tools** → `src/tools/` (`@tools`, one entry), the commands that run no
  agent: `mcp add`, `mcp remove`, `mcp tutorial`, `slack`, `doctor`,
  `provision`, `cli add` and `skill list`. A tool may import env, shared and the
  `@agent` entry (the MCP tutorial's prompt stream only), never the programs,
  host, TUI, headless or CLI, and no program imports it. Its screens live in
  `src/tui/tools/<id>/`, run by `runTuiTool`; every tool runner resolves an exit
  code. See [src/tools/README.md](src/tools/README.md)
- **TUI** → the interactive host (`runTui`), screens, primitives and the screen
  store in `src/tui/`, which other layers enter only through its one entry,
  `@tui` (`src/tui/index.ts`); see [src/tui/README.md](src/tui/README.md). Each
  program's flow, deck and screens live in `src/tui/programs/<id>/`, and each
  tool's in `src/tui/tools/<id>/`, entered through its `index` module; the TUI
  core reaches them only through the TUI program and tool registries. A
  program's flow uses a step a tool also shows, such as the MCP install, by its
  core screen id
- **Headless** → the host with no screens (`runHeadless`) and `LoggingUI` in
  `src/headless/`, which other layers enter only through its one entry,
  `@headless` (`src/headless/index.ts`); see
  [src/headless/README.md](src/headless/README.md). The two hosts share only the
  kind of session store they build, `SessionStore` in `@programs`, and the host
  layer; neither loads the other's code, and each calls `runProgram`; see
  [what calls what](README.md#what-calls-what)
- **CLI** → commands, runners and the choice of host in `src/cli/`, the only
  layer that imports both the TUI and headless, each through its entry. `bin.ts`
  checks the Node version and loads `main.ts`, which imports the CLI through its
  entry, `@cli` (`src/cli/index.ts`); see
  [src/cli/README.md](src/cli/README.md)
- **Layers** → one tsconfig project per layer folder, on TypeScript project
  references, and `pnpm typecheck` is `tsc -b`. A project's `references` name
  the layers it may import, so importing a file of any other fails with TS6307.
  Outside the TUI, `ink`, `react`, `@inkjs/ui` and `ink-testing-library` resolve
  to a fence that fails every import form. ESLint rules in `pnpm lint` close the
  paths the compiler can't see: a relative import that leaves its layer's folder
  and a deep alias outside its own layer; a `.tsbuild/` or `node_modules/` path
  in an import, re-export, `import()` or `typeof import()`; any import of
  `module` or `node:module`; a bare `require`; and triple-slash `path`
  references; see
  [layer boundaries](.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries)
  and [import aliases](README.md#import-aliases). Code outside a layer imports
  it only through its public entries. Each layer's tests sit in its project, so
  a test deep-imports only its own layer and mocks another through its entry.

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

This is the contribution policy; existing programs' bindings vary, and
`DEFAULT_BINDING` is Pi + linear. Set new bindings
explicitly and check sequence-specific hooks before migrating existing flows.
See
[execution policy and model admission](.claude/skills/wizard-development/SKILL.md#execution-policy-and-model-admission)
for the gateway allowlists, required system prompt, and composition constraints.

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
| `wizard audit events`         | event capture quality + cost                        |
| `wizard audit all`            | comprehensive audit across every area (**default**) |
| `wizard audit autocapture`    | autocapture setup + cost                             |
| `wizard audit feature-flags`  | feature flag usage + cost                            |
| `wizard audit identify`       | `$identify` implementation                           |
| `wizard audit session-replay` | session replay setup                                 |
| `wizard audit web-analytics`  | web analytics setup (**wizard-native**, not a skill) |

### Commands vs. skills (the `audit [skill]` gotcha)

A skill and a command are the **same machinery** — a context-mill skill becomes
a command when its `cli:` block sets `role: command`. So `wizard audit events`
_is_ the `audit-events` skill, just promoted. `wizard skill <skill-name>`
([`skill.ts`](src/cli/commands/skill.ts)) runs a skill that **wasn't** promoted.

Two surfaces, one mechanism. So `wizard audit <subcommand>` is choosing an audit
area — it is **not** asking for a skill name, despite `wizard audit --help`
labelling the positional `[skill]` (a wizard-internal name we left as-is). Don't
confuse it with the top-level `wizard skill` command.

### Where the surface is defined (source of truth)

- **Registration:** `runCli` in [`src/cli/index.ts`](src/cli/index.ts) — the
  `.use()` chain wires each command, and [`main.ts`](main.ts) calls it once the
  Node check in [`bin.ts`](bin.ts) passes. Each command has its own file or
  folder in `src/cli/commands/`.
- **Command shape:**
  [`src/cli/commands/command.ts`](src/cli/commands/command.ts) — the `Command`
  interface every command implements.
- **Flat native commands** (e.g. `revenue-analytics`, `upload-source-maps`) are
  built with `nativeCommandFactory`
  ([`src/cli/commands/factories/native-command-factory.ts`](src/cli/commands/factories/native-command-factory.ts)) in a one-line command file, such as [`revenue.ts`](src/cli/commands/revenue.ts).
- **Family commands** (e.g. `audit`) resolve subcommands at runtime against the
  `cliEntries` in `skill-menu.json`. Logic lives in
  [`src/cli/commands/dispatch-family.ts`](src/cli/commands/dispatch-family.ts).
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
[`src/cli/commands/upload-sourcemaps.ts`](src/cli/commands/upload-sourcemaps.ts).
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
pnpm typecheck                     # tsc -b, one project per layer
pnpm fix                           # Auto-fix lint issues
pnpm dev                           # Build, link globally, watch for changes
```

Choose verification for the change: check links and formatting for docs; run
`pnpm typecheck` and focused existing tests for code. Build when bundling or
runtime behavior changes. `pnpm test` already builds; avoid building twice. Use
nonmutating lint checks, and scope formatting fixes to edited files. Do not add
tests for prose, compiler-enforced shapes, or duplicated implementation. Keep
new code comments to one line; put longer explanations in linked docs.

Local `--ci`, smoke-test, and full headless runs require two separate secrets:
a PostHog personal API key and an already-issued gateway token supplied through
`WIZARD_CI_GATEWAY_TOKEN_FILE`, plus the target project ID. Follow the
[credential setup](docs/local-dev.md#credentials-for-local-ci-and-headless-runs).

### Local dev targets

Four things can independently point at a local server — the wizard binary,
context-mill (`:8765`), the MCP server (`:8787`), and PostHog (`:8010`). One
flag per service (`--local-context-mill`, `--local-mcp`, `--local-posthog`),
plus `--local-dev` for all three. Only non-production builds accept them, such
as `pnpm try` and `pnpm build:ci`; production builds, including the published
package and the `pnpm dev` link, reject them.

Note `wizard mcp add --local` is **not** one of these — it writes a
`posthog-local` entry into your editor's MCP config, and is unrelated to where a
wizard run points. Full catalog: [`docs/local-dev.md`](docs/local-dev.md).

## Repository conventions

- Write documentation as the current design. Describe behavior and usage
  directly; omit change history, migration narration, and implementation
  rationale. Apply the same style to PR descriptions.

- TypeScript everywhere. Use `type` (not `interface`) for framework context
  types so they satisfy `Record<string, unknown>`.
- Programs never use the UI. A program's `run` and `ciPreRun` get a runner
  context, and `onReady` gets a ready context. TUI code reports through the
  store it is handed, headless through its `LoggingUI`, and the CLI through
  `consoleLog`; there is no UI interface shared between hosts, and nothing looks
  a UI up. Never import the store directly from business logic.
- Shared and host helpers take a sink or return data; there are no
  process-global sinks. An agent run's debug lines are info log progress, shown
  by the host's progress handler. An abort takes its presenter as its first
  argument: `abortOnScreens(store)` in the TUI, `printAbortOutro` in headless
  and before the TUI mounts.
- Outside `src/agent`, import the agent through `@agent` or `@agent/types`, and
  every other layer through its entries. An entry re-exports only from layers
  its consumers also map, so no declaration turns to `any` in a consumer. Add to
  an entry rather than deep-importing; `pnpm typecheck` and `pnpm lint` reject a
  deeper path in layer source, tests, the e2e harness, scripts and docs examples. A test of
  another layer's internals belongs in that layer's tests, and a test helper
  beside the tests that use it.
- Session mutations go through explicit store setters, which notify the store's
  subscribers. Never mutate `session` directly — nanostore holds a shallow copy.
- State only the TUI reads (a screen's answer, what an overlay shows) lives in
  the TUI store (`TuiState`, read as `store.X`), never in the shared session.
- The router resolves the active screen from the session and the TUI state. No
  imperative navigation (`goTo`, `navigate`, `push`) anywhere.
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
