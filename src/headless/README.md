# Headless

The headless layer is the host for a run with no screens, for `--ci` and
headless runs. It shares nothing with the TUI but the kind of session store it
builds. It owns:

- **`runHeadless`**, the host: it builds its own `SessionStore`, logs in with
  the API key, streams the run's state, and calls `runProgram` with no workflow,
  so a step that needs a decision takes its default. It resolves an exit code
  for the CLI: 0 on success, a failure's through `wizardAbort` with its code in
  the stream's last push, and 130 or 143 on a signal. Its aborts print their
  outro and machine-readable line through `printAbortOutro`
  (`@shared/console-log`).
- **`LoggingUI`**, internal to headless, which prints a run as log lines.
  `logProgress` turns a run's progress into those lines, a debug run's lines
  among them. Its intro, outro and log lines are `consoleLog`'s, the printer
  commands that are not program runs use.

## Modes and callers

Two flags start a headless run. Both go through `runNonInteractive` to `runHeadless`, and differ in who calls them and where the run's state goes.

| Mode | Flag | Builds | Callers | Run state goes to |
| --- | --- | --- | --- | --- |
| `ci` | `--ci` | Non-production only | Wizard CI, the workbench, benchmarks, smoke tests | A local JSONL file (`--task-stream-log`), never PostHog |
| `headless` | `--headless-DONOTUSE-EXPERIMENTAL` | Every build, hidden from `--help` | Cloud runs from the PostHog app | The PostHog backend, so the web app shows live progress. `--no-telemetry` turns the push off |

- Both log in with an API key (`--api-key`), never OAuth, and answer every step with its default.
- The headless flag has a deliberately scary name. Its contract is unstable, so external callers must not rely on it. [`src/shared/headless-mode.ts`](../shared/headless-mode.ts) is the only file that names it.
- A cloud run carries `--run-id` (or `POSTHOG_WIZARD_RUN_ID`), the WizardRun it reports under.
- The Growth team owns the headless runner and cloud runs.

## Entry and imports

Headless's one entry is [`index.ts`](index.ts), `@headless`; no other layer
imports a headless module behind it. It exports `runHeadless`, which loads the
host on first call, the launch types `HeadlessLaunch` and `NonInteractiveMode`,
and `modeLabel`. `LoggingUI` and the renderers stay internal.

Headless may import `@env`, `@shared/*`, `@utils/*`, `@host/*`, `@agent/types`,
`@programs` and `@programs/types`. It never imports the TUI, the CLI or `@agent`
values, and `ink` and `react` resolve to a fence that fails every import form
here. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Where things live

| What                  | Where                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The host              | [`run.ts`](run.ts)                                                                                                |
| Progress as log lines | [`renderers/progress-log.ts`](renderers/progress-log.ts) and [`renderers/logging-ui.ts`](renderers/logging-ui.ts) |
