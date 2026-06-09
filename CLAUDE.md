# PostHog Wizard

The PostHog wizard (`npx @posthog/wizard`) is a CLI that adds PostHog to a user's project using an AI agent. It authenticates the user, detects their framework, runs an agent that integrates the SDK and instruments events, and walks the user through their first dashboard. All from the terminal.

User-facing docs: https://posthog.com/docs/ai-engineering/ai-wizard

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

For CLI surface changes (adding/renaming/retiring a command, adding flags), read [`CONTRIBUTING.md`](CONTRIBUTING.md) — the convention, the three flag categories, and the contributor decision tree. [`docs/cli.md`](docs/cli.md) is the auto-generated reference for what currently exists.

**After any CLI surface change, run `pnpm docs:cli` to regenerate `docs/cli.md`.** The file is committed but generated — `scripts/generate-cli-docs.cjs` reads the bootstrap manifest plus the wizard-native command list and writes the markdown. CLI changes include: updating `cli-manifest.bootstrap.json`, adding/renaming a wizard-native command, or syncing a new context-mill release whose manifest entries you want reflected. Skipping this step ships a stale public-facing reference.

## Skills available

Four skills live under `.claude/skills/`. Read `wizard-development` first for any structural change; then load the relevant procedural skill:

| Skill | When to use |
|---|---|
| `wizard-development` | Before any structural change. Design principles + decision framework. |
| `adding-framework-support` | Adding a new framework integration (e.g. Ruby on Rails, Go, Angular). |
| `adding-skill-program` | Adding a new skill-based program (e.g. a new product feature setup). |
| `ink-tui` | Building or modifying TUI screens, layouts, and primitives. |

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

## Companion projects

- **[context-mill](https://github.com/PostHog/context-mill)** — builds and
publishes the markdown skills the wizard agent uses for framework-specific integration knowledge. Skills are decoupled from the wizard release cycle so docs and integration patterns can update independently.
- **[wizard-workbench](https://github.com/PostHog/wizard-workbench)** — the
development and testing environment. Houses framework test apps (Next.js, React Router, Django, Flask, Laravel, SvelteKit, Swift, TanStack, FastAPI) with no PostHog installed, plus an `mprocs`-driven local dev stack that runs context-mill + MCP + the wizard together with hot reload. Use this to develop and test wizard changes against real projects.
- **[warlock](https://github.com/PostHog/warlock)** — the security scanner engine for PostHog's agentic flows. Bundles YARA-X rules for prompt injection, exfiltration, destructive operations, supply chain attacks, hardcoded secrets, and PII. Engine-only: it returns matches with category/severity/action metadata; the wizard decides how to respond. New security rules belong in warlock, not in the wizard.

## Repository conventions

- TypeScript everywhere. Use `type` (not `interface`) for framework context
types so they satisfy `Record<string, unknown>`.
- All UI calls go through `getUI()` (returns `WizardUI` interface). Never import
the store directly from business logic.
- Session mutations go through explicit store setters that call `emitChange()`.
Never mutate `session` directly — nanostore holds a shallow copy.
- The router resolves the active screen from session state. No imperative
navigation (`goTo`, `navigate`, `push`) anywhere.
- Public CLI surface is **derived**, not declared. Skill-backed commands come
from context-mill's `cli-manifest.json` (snapshotted at build time into
`src/lib/programs/cli-manifest.generated.ts`); wizard-native commands are
hand-listed in `bin.ts` and constructed via `nativeCommandFactory(config)`.
Adding a new skill-backed public command is a context-mill PR, not a wizard
PR — see [CONTRIBUTING.md](CONTRIBUTING.md) for the decision tree.
- Internal flags (`--playground`, `--benchmark`, `--ci`, `--skill`, etc.) are
`hidden: true` and consolidated in `src/wizard.ts::GLOBAL_OPTIONS` or the
default command. Don't add new top-level visible flags without checking the
"when to add a flag" rules in [CONTRIBUTING.md](CONTRIBUTING.md).
- Never write secrets to source code or hardcode API keys. Use the
`wizard-tools` MCP server (`check_env_keys` / `set_env_values`) for `.env` file operations.
- Feedback / issues: wizard@posthog.com or
[GitHub Issues](https://github.com/posthog/wizard/issues).


