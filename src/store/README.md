# store

Render-agnostic state and the contract between the agent and whatever renders.

## Owns

- `state/`: `RunStore`, `FlowStore`, flows, interrupts, screen resolution, run
  failure. A `RunStore` is the state of one agent run: its copy of the session,
  tasks, phase, outro, and the questions the agent asks. `FlowStore` owns the
  flow, gates, interrupts, and the session every run inherits; it chains runs
  through `startRun(session)`, mirrors the active run in its `session`, and
  re-emits the run's commits. The agent writes through `StoreUI` to the
  `FlowStore`, which routes run state to the active `RunStore`; the task stream
  reads one `RunStore`; screens and the control API read the `FlowStore`. The
  dashboard and notebook a run creates are session artefacts and stay on the
  flow, so a later run and the outro still link them.
- `session/`: `WizardSession`, ask policy, ask bridge, secret vault.
- `ui/`: the `WizardUI` interface, `getUI`/`setUI`, `StoreUI`, `NullUI`.
- `agent-protocol/`: run configs, agent signals, token pricing, subprocess env.
- `programs/`: program registry, run configs, flows as data, detection modules.
- `tools/`: wizard tool behavior shared by every harness facade.
- `detection/`, `frameworks`, `services/`, `security/`, `task-stream/`,
  `shared/`.
- `control/`: the control API. An HTTP/1.1 server over a unix socket that
  mirrors one store. `GET /state` is the committed session whitelist
  (`CONTROL_SESSION_KEYS`, credentials as a flag), the run atoms, and the
  actions legal on the current screen; `?wait=&since=` blocks on the store
  version. `POST /actions/<id>` is one store setter legal on the current screen;
  `POST /store/<setter>` is one whitelisted setter whatever the screen
  (`control/setters.ts`, listed by `GET /store`); `POST /run` is `requestRun`.
  `POST /credentials`, `POST /detect`, `POST /runs` (headless surface), and
  `POST /shutdown` call `ControlHooks` the cli implements, because the store
  never authenticates or runs agents. Generic actions live in
  `control/actions.ts`; a program adds its own through
  `FlowStep.controlActions`.

## Never contains

Ink, rendering, or any import of `@agent`, `@tui`, or `@cli`. Two shared helpers
write to stderr on purpose: the terminal bell and the machine-readable error
line.

## May import

`@env` and its own files. Nothing else.

## Public entries

- `index.ts`: runtime API. `types.ts`: every type another surface consumes.
- `programs/index.ts`: program registry and definitions.
- `control/index.ts`: the control server and client. Loaded only through a
  dynamic import from the two cli runners, so a published TUI never carries it;
  `scripts/smoke-test.sh` audits the built chunks.
- Agent implementations arrive by injection: `setUI`, `setDetectionAgent`,
  `setMcpPromptRunner`.

## Tests

`pnpm test:store` and `pnpm typecheck:store`. `vitest.config.ts` resolves only
`@env` and `@store`; an import of any other surface fails at load and `ink`
throws. `testing/` holds `createTestStore`; shipped code never imports it.
`__tests__/contract.test.ts` pins the boundary: `StoreUI` and `NullUI` implement
`WizardUI`, `ProgramConfig` extends `ProgramRunConfig`, `runConfigFor` emits
nothing beyond the run contract, and `FlowStore` satisfies `FlowStoreApi`
(`state/store-api.ts`, whose member list the architecture suite derives from
real tui, cli, and harness usage). Goldens live under
`**/__tests__/__snapshots__` and must stay byte identical across refactors.
