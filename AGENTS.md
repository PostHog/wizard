# AGENTS.md

## Commands

- **Build**: `pnpm build` (tsc + copies assets + smoke test)
- **Test**: `pnpm test` (builds first, then Jest)
- **Single test**: `pnpm test:watch -- --testPathPattern=<pattern>`
- **Lint**: `pnpm lint` (Prettier + ESLint)
- **Fix**: `pnpm fix` (auto-fix lint issues)
- **Dev**: `pnpm try --install-dir=<path>` (run without building via tsx)
- **E2E**: `pnpm test:e2e`

## Architecture

The PostHog wizard is a CLI tool (`npx @posthog/wizard`) that uses AI agents to add PostHog to user projects.

**Core flow**: `bin.ts` (CLI entry, arg parsing) -> `src/run.ts` (orchestration) -> detects framework via `src/lib/registry.ts` -> runs framework-specific agent from `src/frameworks/<name>/`

**Key abstractions**:
- `FrameworkConfig` (`src/lib/framework-config.ts`) -- interface every framework implements (detection, prompts, env config, UI)
- `Integration` enum (`src/lib/constants.ts`) -- detection order matters: frameworks before language fallbacks
- `WizardSession` (`src/lib/wizard-session.ts`) -- session state threaded through the agent run
- Agent runner (`src/lib/agent-runner.ts`) -- LLM agent orchestration

**UI layer**: Ink-based TUI (`src/ui/tui/`) with a logging fallback (`src/ui/logging-ui.ts`) for non-interactive environments.

**Steps** (`src/steps/`) -- shared post-install operations (env vars, MCP server setup, prettier formatting).

**Health checks** (`src/lib/health-checks/`) -- `evaluateWizardReadiness()` checks external service status before running.

## Conventions

- Conventional commits, PR titles validated by CI
- `.js` extension required for relative imports (Node16 module resolution)
- Tests colocated in `src/**/__tests__/` using Jest with ts-jest
- Every CI workflow job must declare `timeout-minutes`
