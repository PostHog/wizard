# Host

The host layer is what the two hosts, the TUI and headless, share about running
the wizard as a process: how a run ends, and the control API. It owns:

- **The exit.** A host starts its exit with `startHostExit` and resolves an exit
  code; only the CLI and `bin.ts` call `process.exit`. `wizardAbort` ends a
  decided failure with the presenter its caller passes, `registerShutdown` adds
  a hook the end runs first, and `withControlledAbort` turns an abort inside a
  control route into that route's error.
- **The control API**, a server on a unix socket that lets another process read
  a run's state and act on it, with its client and run ledger. Each host
  attaches its own server: headless serves its session store and answers the
  agent's questions from the parent, and a controlled TUI run serves its store
  while its flow runs.

## Entry and imports

The TUI and headless import it through `@host/*`: `@host/wizard-abort` for the
exit and `@host/control` for the control API. The CLI and the e2e harness may
import it too. A host loads `@host/control` with a dynamic import, only when a
socket is asked for.

The host layer may import `@env`, `@shared/*` and `@utils/*`, and nothing else:
the programs, the agent, the TUI, headless and the CLI are out of its reach, and
the programs and the agent never import it. So the server knows no program: a
host passes the program ids a request may name. See
[layer boundaries](../../.claude/skills/wizard-development/references/ARCHITECTURE.md#layer-boundaries).

## The control API

`--control-socket=<path>` serves it; the
[developer interfaces](../../docs/developer-interfaces.md#the-control-api) cover
the flags and modes. The server answers the routes listed in `ROUTES` with JSON.
It reads and commits through a `ControlTarget` and calls `ControlHooks` for
login, detection, runs and shutdown. Headless serves the session store's target
with its own hooks; the TUI serves its store's target with a login and a
shutdown hook, and answers `POST /runs` and `POST /detect` with 501.

| What                                           | Where                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| The exit, aborts and shutdown hooks            | [`wizard-abort.ts`](wizard-abort.ts)                                |
| The server and its routes                      | [`control/server.ts`](control/server.ts)                            |
| The parent's side: one method per route        | [`control/client.ts`](control/client.ts)                            |
| Every run the process served                   | [`control/runs.ts`](control/runs.ts)                                |
| Controlled headless: serve and hooks           | [`src/headless/control`](../headless/control/serve.ts)              |
| The TUI's attach, with its hooks               | [`src/tui/run.ts`](../tui/run.ts)                                   |
| The session store's state, answers and setters | [`src/programs/session/control.ts`](../programs/session/control.ts) |
| The TUI's screen actions, setters and state    | [`src/tui/control`](../tui/control/index.ts)                        |
| The wire types, params and redaction           | [`src/shared/control`](../shared/control/types.ts)                  |
| The control-socket flags                       | [`control-flags.ts`](../cli/control-flags.ts)                       |
