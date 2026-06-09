# Contributing to the PostHog wizard

This is the contributor doc — design conventions, internal tooling, gotchas.
For getting started using the wizard, see the [README](README.md). For docs
aimed at end users, see [posthog.com/docs/ai-engineering/ai-wizard](https://posthog.com/docs/ai-engineering/ai-wizard).

## Internal CLI flags

The wizard ships a set of "internal mode" flags — they're accepted everywhere
but hidden from `--help` so end users never trip over them. Each one is for
development, debugging, or test infrastructure.

| Flag | What it does |
|---|---|
| `--playground` | Launches the TUI primitives playground (an Ink demo harness for layout, picker, content blocks, MCP install screen, etc.). Lives in `src/ui/tui/playground/`. Add new primitive demos here. |
| `--benchmark` | Runs the agent in benchmark mode with per-phase token tracking and detailed timing. Wires up middleware that publishes timing to a JSON report. Use when measuring run-time cost regressions. |
| `--yara-report` | Prints a summary of YARA scanner matches after the agent run finishes (otherwise scanner findings are only logged on block/revert). Useful when iterating on warlock rules. |
| `--local-mcp` | Points the wizard at a local MCP server (`http://localhost:8787/mcp`) instead of `mcp.posthog.com`. Pairs with wizard-workbench's local stack so changes to the MCP surface are testable without deploying. |
| `--ci` | Runs the wizard non-interactively (no TUI). Only available in dev/test builds — disabled in published releases (`feat: disable --ci in published builds`). Used by E2E tests and CI integrations. |
| `--skill <id>` | Dev escape hatch: runs an arbitrary context-mill skill by ID, bypassing the curated public command surface. Combine with `--ci` for headless skill runs. Use when iterating on a skill that isn't promoted to `surface: public` yet. |

Each flag is also reachable via env var with the `POSTHOG_WIZARD_` prefix
(e.g. `POSTHOG_WIZARD_BENCHMARK=1`).

### Where they're declared

Global internal flags (`--local-mcp`, `--benchmark`, `--yara-report`, `--ci`)
live in `src/wizard.ts` under `GLOBAL_OPTIONS` with `hidden: true`. They apply
to every command automatically — no need to repeat them in per-command option
blocks.

Default-command-only flags (`--playground`, `--skill`) live in
`src/commands/basic-integration/index.ts` on the `basicIntegrationCommand`
options block, also `hidden: true`. They only make sense on the bare
`wizard` invocation because they replace the entire run mode.

### Adding a new internal flag

1. Decide scope: does the flag apply to every command, or only the default
   command? Apply-everywhere flags go in `GLOBAL_OPTIONS`; default-only flags
   go in `basicIntegrationCommand.options`.
2. Set `hidden: true`. Internal flags are never exposed in `--help`.
3. Add a row to the table above explaining what the flag is for. If a future
   contributor reads CONTRIBUTING.md and can't tell whether a flag is safe to
   touch, the documentation is failing.

## Public CLI surface

The public surface follows the convention documented in the CLI overhaul
plan: external commands are flat when the wizard can auto-detect the
variant, and grouped into families (`wizard audit <leaf>`, `wizard migrate
<vendor>`) when the user has to pick.

The full public catalog is derived from context-mill's manifest at build
time (snapshot lives in `src/lib/programs/cli-manifest.generated.ts`, fed
by `scripts/generate-cli-manifest.cjs`). Adding a new public skill-backed
command is a context-mill change — set `surface: public` on the skill's
`config.yaml` `cli:` block. The wizard's next release picks it up
automatically.

Wizard-native commands (`doctor`, `mcp`, `source-maps`, `skill`, default
integration) are hand-listed in `bin.ts`. Add a new one via
`nativeCommandFactory(config)`; see `src/commands/source-maps.ts` for the
one-liner pattern.

More contributor docs will land in this file as the CLI overhaul completes
(Phase 8). For now this covers the internal-flag question.
