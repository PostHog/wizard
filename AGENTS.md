# PostHog Wizard Development Guide

## Codebase Structure

- Entry point: `bin.ts` (CLI arg parsing, Node version check, UI selection)
- Core runner: `src/run.ts` (wizard orchestration)
- Frameworks: `src/frameworks/<name>/` -- each exports a `FrameworkConfig` (see `src/lib/framework-config.ts`)
- Steps: `src/steps/` -- shared post-install steps (env vars, MCP server setup, prettier)
- UI layer: `src/ui/` -- Ink-based TUI (`src/ui/tui/`) and logging fallback (`src/ui/logging-ui.ts`)
- Agent runner: `src/lib/agent-runner.ts`, `src/lib/wizard-session.ts` -- Claude Agent SDK orchestration
- Constants: `src/lib/constants.ts` -- `Integration` enum, framework detection order
- Registry: `src/lib/registry.ts` -- maps integrations to framework configs
- Tests: colocated in `src/**/__tests__/` directories

## Commands

- Build: `pnpm build` (runs `tsc`, copies scripts/rules/package.json, runs smoke test)
- Test: `pnpm test` (builds first, then runs Jest)
- Test watch: `pnpm test:watch`
- Lint: `pnpm lint` (Prettier + ESLint)
- Fix: `pnpm fix` (auto-fix lint issues)
- Dev: `pnpm try` (runs `tsx bin.ts` directly without building)
- E2E: `pnpm test:e2e` (builds, then runs `e2e-tests/run.sh`)
- Smoke test: `pnpm test:smoke` (verifies compiled binary loads without crashing)

## Commits and Pull Requests

Use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/). PR titles are validated by CI.

Prefixes: `feat`, `fix`, `docs`, `test`, `ci`, `refactor`, `perf`, `chore`, `revert`

Keep the first line under 50 characters, subject only, no body.

## Code Style

- TypeScript required, no `any` types in production code
- Use Zod for runtime validation of external data (API responses, file contents)
- Tests use Jest with `ts-jest`, colocated in `__tests__/` directories
- Naming: camelCase for variables/functions, PascalCase for types/classes
- Imports: use `.js` extension for relative imports (Node16 module resolution)

## Adding a New Framework

1. Create `src/frameworks/<name>/` with a file exporting a `FrameworkConfig`
2. Add the integration to the `Integration` enum in `src/lib/constants.ts` (detection order matters: frameworks before language fallbacks)
3. Register it in `src/lib/registry.ts`
4. Add tests in `src/frameworks/<name>/__tests__/`

See an existing framework like `src/frameworks/nextjs/` for the pattern.

## CI

- Every workflow job must declare `timeout-minutes`
- Build & test runs on Node 20.20.0, 22.22.0, and 24
- PRs trigger: build, lint, unit tests, conventional commit validation
- Main branch: build, publish (if version bumped), smoke test, release-please
- `/wizard-ci <app>` PR comment triggers integration tests against [wizard-workbench](https://github.com/PostHog/wizard-workbench)
