# Shared

Library code every surface may import: constants, the API and host types, error codes, fetch retry, the skill menu, Claude settings handling, the secret vault, health checks and the utilities under `utils/`. Nothing here depends on the host layer, the agent, the programs, the TUI, headless or the CLI.

Shared also holds process-global state, one copy per process for every layer
that imports it:

- `@utils/debug`: the log file: `POSTHOG_WIZARD_LOG_FILE` in a dev build, or the
  default, and the CLI's `--log-file` through `configureLogFile`.
- `@utils/analytics`: the `analytics` client.
- `@utils/cleanup`: the cleanup list that runs before exit (`registerCleanup`).
- `@shared/oauth-session`: the process's one OAuth login session: its
  credentials and their rotation (`configureOAuthSession`). Runs in one process
  may follow each other but not overlap.
- `@shared/auth-session-state`: whether the token endpoint refused the grant
  (`markGrantRevoked`, `isGrantRevoked`).
- `@shared/local-dev`: the resolved local-dev targets (`initLocalDev`).
- `@shared/fetch-retry`: the skills origin that last worked, which the next
  fetch tries first.

## Signatures

Import by path: `@shared/<module>` for the singles and `@utils/<module>` for `src/shared/utils`. There is no barrel; a shared library loads what a caller names and nothing else.

Modules callers reach most:

- `@shared/constants`: integrations, harnesses, sequences, URLs and `getSkillsBaseUrl()`.
- `@shared/errors`: `ErrorCodes`, `WizardError`, `emitWizardError`, `classifyRunFailure`, `classifyAuthFailure`, the catalog.
- `@shared/api`: `Credentials`, `ApiUser`, `ApiProject`.
- `@shared/host-resolution`: `HostResolution`, the immutable snapshot of where the wizard talks to.
- `@shared/fetch-retry`: `fetchWithRetry(url, { fetchImpl?, sleepImpl?, maxAttempts? })`, one retry and failover policy for every critical-path fetch.
- `@shared/skill-menu`: `fetchSkillMenu(skillsBaseUrl, retryOpts?)` returns the parsed `SkillMenu` or `null`; `expandBundleEntry`, `SkillEntry`, `CliEntry`.
- `@shared/skill-install`: `downloadSkill(entry, installDir, options?)` and
  `installSkillById(skillId, installDir, skillsBaseUrl, options?)` install a
  skill into a project; `InstallSkillResult`, `isSkillInstallCommand`.
- `@shared/ask-policy`: `shouldDisableAsk(flags)` and `LONGER_ASK_TIMEOUT_MS`,
  when `wizard_ask` may reach a human and how long an errand question waits.
- `@shared/claude-settings`: settings conflict detection, backup and restore.
- `@shared/secret-vault`: the session-scoped vault the tools resolve secret references through.
- `@shared/health-checks`: `evaluateWizardReadiness`, `checkAllExternalServices` and the gateway and skills-origin endpoint checks.
- `@shared/mcp-clients/install`: detect the supported MCP clients, and add,
  remove or check the PostHog MCP server and plugin in each, one result per
  client. The TUI's MCP screen and the `mcp` tools share it.
- `@shared/oauth-scopes`: `withScopeAdditions(base, additions)` and the scope
  additions more than one layer asks for, such as
  `CONNECT_SLACK_SCOPE_ADDITIONS`.
- `@shared/api-key-login`: `resolveApiKeyProject(apiKey, options)`, the host,
  project and user a personal API key logs in to.
- `@shared/ci-gateway`: `readCiGatewayCredential(region)`, the gateway token a
  dev or test `--ci` run reads from `WIZARD_CI_GATEWAY_TOKEN_FILE`, then clears
  from the environment.
- `@shared/console-log`: `consoleLog`, the glyph printer console commands and
  headless's log lines print through, its `ConsoleLog` shape, and
  `printAbortOutro`, the abort presenter for a run that prints.
- `@utils/debug`: `logToFile`, `initLogFile`, `getLogFilePath`,
  `configureLogFile` and `formatLogLine`, the line format `logToFile` writes.
- `@utils/analytics`: the `analytics` client (`wizardCapture`, `captureException`, `setTag`, `flush`, `shutdown`).
  `@utils/flush-analytics`: `flushAnalytics()`, a flush that never fails the caller.
- `@utils/telemetry`: `withProgress(step, fn)` tags analytics with the current step and runs `fn`.
- `@utils/package-manager`, `@utils/env-scan`, `@utils/bounded-fs`, `@utils/atomic-ledger`, `@utils/semver`, `@utils/urls`, `@utils/links`.

Callback convention: a shared helper that needs to show something takes a sink or returns data. It never looks the UI up, and no shared module holds a sink.

```ts
import { resolveApiKeyProject } from '@shared/api-key-login';

// The caller's own printer: a warning shows wherever that caller shows it.
await resolveApiKeyProject(apiKey, { onWarning: (line) => log.warn(line) });
```

A diagnostic with no caller to show it goes to the log file (`logToFile`).

## Intent

Shared exists so the agent, programs, TUI, headless and CLI code can use one implementation of the things they all need without importing each other. A helper belongs here when it needs no surface-specific dependency and would otherwise be copied. Module state belongs here only when the whole process shares one copy of it, as in the list above.

## Architecture

Shared imports `src/env.ts` and itself, and nothing else. It compiles as its own
tsconfig project, [`tsconfig.json`](tsconfig.json), which references only
[`src/tsconfig.json`](../tsconfig.json), the project that holds `env.ts`. An
upward import, such as `@host/*`, fails `pnpm typecheck` with TS6307, and a
relative import out of `src/shared` fails ESLint.

Ending a run isn't shared's job. `startHostExit`, `wizardAbort`,
`registerShutdown` and the `AbortPresenter` type live in the host layer,
`@host/wizard-abort`, which shared can't import. They follow the callback
convention too. `wizardAbort(host, options)` shows its outro through the
presenter its caller passes, then hands its code to the host's exit.
