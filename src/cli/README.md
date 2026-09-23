# CLI

The CLI parses argv, picks the surface, and wires it: it is the only layer that
looks up the current UI, exits the process, or imports both the TUI and the
headless surface. Everything below it receives its hosts as arguments.

## Signatures

`bin.ts` checks the Node version, heals orphaned settings backups, registers the
commands and calls `Wizard.init()`. Each command maps its argv onto a program
config and one of the runners:

```ts
runWizard(config: ProgramConfig, options: Record<string, unknown>): void   // TUI
runWizardCI(config, options): void        // --ci (dev/test builds)
runWizardHeadless(config, options): void  // the experimental headless flag
```

Global flags of note (hidden ones are dev/test only unless stated):

| Flag                                                                            | Effect                                                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `--install-dir`, `--api-key`, `--project-id`, `--region`, `--email`, `--signup` | Launch values the session starts from.                                                                           |
| `--ci`                                                                          | Non-interactive run in dev/test builds; published builds refuse it.                                              |
| `--headless-DONOTUSE-EXPERIMENTAL`                                              | Published non-interactive run; unstable.                                                                         |
| `--control-socket <path>`                                                       | Serve the control API over a unix socket. Published builds accept it only with the headless flag.                |
| `--partial-control`                                                             | Control mode: user commits only (the default).                                                                   |
| `--full-control`                                                                | Control mode: also every store setter. Cannot combine with `--partial-control`; either needs `--control-socket`. |
| `--harness`, `--sequence`, `--model`, `--capture-aio`                           | Runner overrides.                                                                                                |
| `--local-dev`, `--local-context-mill`, `--local-mcp`, `--local-posthog`         | Local service targets.                                                                                           |

## Intent

- `src/cli/ui.ts` holds the current UI (`getUI`, `setUI`): `LoggingUI` until a
  runner installs `InkUI` (through the TUI host) or `HeadlessUI`. It also
  installs the debug sink.
- `src/cli/wizard-abort.ts` is the single exit path: cleanups, analytics, outro,
  exit code.
- `runProgramAgent` (`runners/run-program-agent.ts`) is the session-driven host
  for one program run: gates, login, binding, `runProgram`, and a decided
  failure through its `abort` option (`wizardAbort` unless a controlled request
  passes its own).
- `control-hooks.ts` and `control-flags.ts` are the CLI's side of the control
  API: credentials, detection, runs, shutdown, and which runs may serve a socket
  in which mode.

## Architecture

```text
bin.ts ── Wizard.use(commands) ──▶ command handler ──▶ runner
                                                         │
     run-wizard ──▶ @tui (loadStartTui, flows) ─────────┤
     run-non-interactive ──▶ @headless (HeadlessUI, loadControl)
                                                         │
                               runProgramAgent ──▶ @programs runProgram ──▶ @agent
```

The CLI imports each surface only through `@tui` / `@tui/types` and `@headless`
/ `@headless/types`, and loads Ink and the control server on demand, so the
startup closure holds neither.
