# Headless

The headless surface runs a program with no terminal UI: `--ci` in dev and test
builds, and the experimental headless flag in published builds. It logs instead
of rendering, logs in with a personal API key, and can serve a control API over
a unix socket so another process (a harness, another agent) drives the run. It
never imports the TUI; the CLI composes the two when a controlled run needs the
TUI store.

## Signatures

```ts
import { LoggingUI, HeadlessUI, loadControl } from '@headless';
import type { HeadlessRunStateSink, ControlServerHandle } from '@headless/types';

const { attachControlServer, ControlClient } = await loadControl();

attachControlServer(
  target: ControlTarget,          // a store's state, actions and setters
  options: {
    socketPath: string;
    surface: 'tui' | 'headless';
    mode: 'partial' | 'full';
    hooks: ControlHooks;          // credentials, detect, startRun, shutdown
    version: string;
    program: string;
  },
): Promise<ControlServerHandle>   // { socketPath, ledger, close() }
```

- `LoggingUI` prints the run as log lines. `HeadlessUI` also tees tasks, handoff
  text and framework context into a `HeadlessRunStateSink` (the CLI passes its
  store) so the task stream can observe the run.
- `ControlTarget`, `ControlHooks` and the wire types live in
  `@shared/control/types`; the TUI's adapter is `wizardStoreControlTarget` from
  `@tui`.
- `ControlClient` is the parent's side: `health()`, `state()`,
  `waitForChange(since, ms)`, `performAction(id, params)`, `setters()`,
  `applySetter(name, params)`, `setCredentials()`, `detect()`, `startRun(body)`,
  `runs()`, `shutdown()`.

## Intent

A plain headless run answers nothing: with no answerer the agent's `wizard_ask`
tool returns its unavailable error and the agent proceeds within its
permissions, and optional-task notices resolve as declined. A controlled run
(`--control-socket <path>`) answers through the socket instead: nothing runs
until the parent asks, questions and notices wait for the parent's answer, and
`POST /shutdown` ends the process.

### High-level control first

Every route answers JSON; errors are `{ ok: false, error }`.

| Route                 | Does                                                                                                                                   | Surfaces |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `GET /health`         | Surface, mode, program, pid, version.                                                                                                  | both     |
| `GET /state`          | The projected state. `?wait=<ms>&since=<version>` long-polls until the next commit.                                                    | both     |
| `GET /runs`           | Every run this process served, in start order, with its outcome and final state.                                                       | both     |
| `GET /store`          | The setters and the mode; callable only under full control.                                                                            | both     |
| `POST /actions/:id`   | One commit the current screen or overlay offers (`{ params }`).                                                                        | both     |
| `POST /store/:setter` | One store setter by name (`{ params }`); 403 unless full control.                                                                      | both     |
| `POST /credentials`   | Resolve the session's API key into credentials.                                                                                        | both     |
| `POST /detect`        | Run the program's detection (`{ programId?, installDir? }`).                                                                           | headless |
| `POST /runs`          | Start one run (`{ programId? , skillId?, installDir?, frameworkContext?, config? }`); a skill alone runs on the generic skill program. | headless |
| `POST /shutdown`      | End the process once idle.                                                                                                             | both     |

Status codes: 400 for an unknown action, setter, program or a bad param; 403 for
a setter under partial control; 409 while a run is in flight (a second run,
detection, credentials, shutdown); 413 past 64 KiB; 415 for a non-JSON body; 501
for a headless-only route on the TUI surface.

A controlled run of `posthog-integration`, end to end:

```ts
const client = new ControlClient(socketPath);
await client.setCredentials();
await client.detect();
await client.startRun({ programId: 'posthog-integration' });
for (let v = 0; ; ) {
  const state = await client.waitForChange(v, 30_000);
  v = state.version;
  if (state.actions.some((a) => a.id === 'answer_question')) {
    await client.performAction('answer_question', {
      answers: { db: 'postgres' },
    });
  }
  if ((await client.runs())[0]?.status !== 'running') break;
}
await client.shutdown();
```

### Pending requests

- A question shows as `state.currentScreen: 'wizard-ask'` with
  `state.session.pendingQuestion`; `answer_question` resolves it with a complete
  answers map, `cancel_question` resolves it with the cancelled sentinel.
  Cancelling a question does not cancel the run.
- Unanswered, a question times out after the bridge's timeout (5 minutes, or 20
  for the long asks) and resolves with sentinel answers and `timedOut: true`;
  the overlay clears so the next question works.
- A task notice shows as `'task-notice'`; `resolve_notice` with `keep: true`
  runs the optional step, `false` skips it.
- Sensitive answers stay out of the state: the projection never carries answer
  values, credentials (only `hasCredentials` and `projectId`), secret-named
  framework-context keys or secret references.

### Partial control

The default mode. The parent acts only through the commits a user could make on
the current screen, with the screen's validation (a setup answer must be one of
the question's options; a project pick must name a known framework). Actions
change with the screen; read `state.actions`. On the headless surface only the
overlays a run raises have actions.

### Full control

`--full-control` additionally routes every public setter of the store, at any
time, including during a run. The store is the TUI's `WizardStore` on both
surfaces. Writing state is not running the wizard: setting the phase to
completed does not finish a run, and a changed framework context does not change
a run definition already resolved. Only `POST /runs` creates a run record; every
setter call is listed, with its time, in `state.controlWrites`, so a parent can
tell written state from run state.

## Architecture

```text
parent ── HTTP/JSON over a unix socket (0600) ──▶ control server (headless)
                                                     │  partial: actions   full: + setters
                                                     ▼
                                             ControlTarget ◀── wizardStoreControlTarget (tui)
                                                     │
                            ControlHooks (cli) ──▶ credentials · detection · runProgramAgent
```

The server owns the socket, the long polls and the run ledger. The target owns
what a store shows and accepts. The CLI's hooks own everything with effects
beyond the store: logging in, detection and running programs, where a decided
failure fails the request instead of exiting.
