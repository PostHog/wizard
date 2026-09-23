# Shared

Stateless library code every surface may import: constants, the API and host types, error codes, fetch retry, the skill menu, Claude settings handling, the secret vault, health checks and the utilities under `utils/`. Nothing here depends on the agent, the programs, the TUI or the CLI.

## Signatures

Import by path: `@shared/<module>` for the singles and `@utils/<module>` for `src/shared/utils`. There is no barrel; a shared library loads what a caller names and nothing else.

Modules callers reach most:

- `@shared/constants`: integrations, harnesses, sequences, URLs and `getSkillsBaseUrl()`.
- `@shared/errors`: `ErrorCodes`, `WizardError`, `emitWizardError`, `classifyRunFailure`, `classifyAuthFailure`, the catalog.
- `@shared/api`: `Credentials`, `ApiUser`, `ApiProject`.
- `@shared/host-resolution`: `HostResolution`, the immutable snapshot of where the wizard talks to.
- `@shared/fetch-retry`: `fetchWithRetry(url, { fetchImpl?, sleepImpl?, maxAttempts? })`, one retry and failover policy for every critical-path fetch.
- `@shared/skill-menu`: `fetchSkillMenu(skillsBaseUrl, retryOpts?)` returns the parsed `SkillMenu` or `null`; `expandBundleEntry`, `SkillEntry`, `CliEntry`.
- `@shared/claude-settings`: settings conflict detection, backup and restore.
- `@shared/secret-vault`: the session-scoped vault the tools resolve secret references through.
- `@shared/health-checks`: `evaluateWizardReadiness`, `checkAllExternalServices` and the gateway and skills-origin endpoint checks.
- `@utils/debug`: `logToFile`, `debug`, `enableDebugLogs`, `setDebugSink`.
- `@utils/analytics`: the `analytics` client (`wizardCapture`, `captureException`, `setTag`, `flush`, `shutdown`).
- `@utils/telemetry`: `withProgress(step, fn)` tags analytics with the current step and runs `fn`.
- `@utils/package-manager`, `@utils/env-scan`, `@utils/bounded-fs`, `@utils/atomic-ledger`, `@utils/semver`, `@utils/urls`, `@utils/links`.

Callback convention: a shared helper that needs to show something takes a sink or returns data. It never looks the UI up.

```ts
import { debug, setDebugSink } from '@utils/debug';

const restore = setDebugSink((line) => myLog.info(line));
debug('resolving host', host); // rendered and handed to the sink
setDebugSink(restore);
```

`src/ui/index.ts` installs the current UI's info log as the debug sink at load, so `debug()` follows `setUI()` without shared code knowing a UI exists. Until the UI module loads, lines go to stdout.

## Intent

Shared exists so the agent, programs, TUI, headless and CLI code can use one implementation of the things they all need without importing each other. A helper belongs here when it holds no run state, needs no surface-specific dependency, and would otherwise be copied.

## Architecture

Shared imports `src/env.ts` and itself. The architecture test classifies `src/shared` as its own surface and lists the remaining upward edges in `src/__tests__/architecture/known-violations.json`; each has an owner in the stack plan. `utils/setup-utils.ts`, `utils/oauth.ts` and `utils/wizard-abort.ts` are TUI and CLI flow code that leave in Release C; `utils/analytics.ts` reads the session until Release B; `claude-settings.ts` and `errors/agent-map.ts` import two agent leaf modules until Release B, because the agent entry would form a module cycle through analytics.
