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
