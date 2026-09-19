# store

Render-agnostic state and the contract between the agent and whatever renders.

## Owns

- `state/`: `WizardStore`, flows, interrupts, screen resolution, run failure.
- `session/`: `WizardSession`, ask policy, ask bridge, secret vault.
- `ui/`: the `WizardUI` interface, `getUI`/`setUI`, `StoreUI`, `NullUI`.
- `agent-protocol/`: run configs, agent signals, token pricing, subprocess env.
- `programs/`: program registry, run configs, flows as data, detection modules.
- `tools/`: wizard tool behavior shared by every harness facade.
- `detection/`, `frameworks`, `services/`, `security/`, `task-stream/`,
  `shared/`.

## Never contains

Ink, console output, or any import of `@agent`, `@tui`, or `@cli`.

## May import

`@env` and its own files. Nothing else.

## Public entries

- `index.ts`: runtime API. `types.ts`: every type another surface consumes.
- `programs/index.ts`: program registry and definitions.
- Agent implementations arrive by injection: `setUI`, `setDetectionAgent`,
  `setMcpPromptRunner`.

## Tests

`pnpm test:store` and `pnpm typecheck:store`. `vitest.config.ts` resolves only
`@env` and `@store`; an import of any other surface fails at load and `ink`
throws. `testing/` holds `createTestStore`; shipped code never imports it.
`__tests__/contract.test.ts` pins the boundary: `StoreUI` and `NullUI` implement
`WizardUI`, `ProgramConfig` extends `ProgramRunConfig`, `runConfigFor` emits
nothing beyond the run contract, and `WizardStore` satisfies `WizardStoreApi`
(`state/store-api.ts`, whose member list the architecture suite derives from
real tui, cli, and harness usage). Goldens live under
`**/__tests__/__snapshots__` and must stay byte identical across refactors.
