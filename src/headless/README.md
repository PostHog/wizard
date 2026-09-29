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
- **Controlled headless**: with `--control-socket`, it runs nothing until the
  parent asks. It serves its session store through the host layer's control API,
  with hooks that log in, detect, run programs and shut down, and answers the
  agent's questions from the parent.

## Entry and imports

Headless's one entry is [`index.ts`](index.ts), `@headless`; no other layer
imports a headless module behind it. It exports `runHeadless`, which loads the
host on first call, and the launch types `HeadlessLaunch` and `HeadlessMode`.
`LoggingUI`, the renderers and controlled headless stay internal. Controlled
headless loads the control server, `@host/control`, with a dynamic import, only
when a socket is asked for.

Headless may import `@env`, `@shared/*`, `@utils/*`, `@host/*`, `@agent/types`,
`@programs` and `@programs/types`. It never imports the TUI, the CLI or `@agent`
values, and `ink` and `react` resolve to a fence that fails every import form
here. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## Where things live

| What                                 | Where                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| The host                             | [`run.ts`](run.ts)                                                                                                |
| Progress as log lines                | [`renderers/progress-log.ts`](renderers/progress-log.ts) and [`renderers/logging-ui.ts`](renderers/logging-ui.ts) |
| Controlled headless: serve and hooks | [`control/serve.ts`](control/serve.ts) and [`control/hooks.ts`](control/hooks.ts)                                 |
| The control server, client and runs  | [`src/host`](../host/README.md#the-control-api)                                                                   |
