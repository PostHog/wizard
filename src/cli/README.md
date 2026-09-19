# cli

Composition root. Parses argv, selects a surface, and forwards to the three
surfaces' public entries. Holds no domain logic.

## Owns

- `main.ts`: installs `LoggingUI`, the detection agent, and the MCP prompt
  runner, then registers every command. `bin.ts` imports it after the Node
  preflight.
- `wizard.ts`, `commands/`: yargs surface. `runners/`: TUI and headless runners
  that sequence independent agent runs and pass context between them.
- `control-hooks.ts`: what the store's control server asks the composition root
  to do: resolve credentials, release the run, detect, start one independent run
  with explicit context, shut down. `--control-socket` attaches the server in
  `run-non-interactive.ts` (headless, every build) and in `run-wizard.ts` (TUI,
  dev builds only). Published TUI runs refuse the flag unless the headless flag
  is present.

## May import

Every surface, but only through `@store`, `@store/types`, `@store/programs`,
`@agent`, `@agent/types`, `@tui`, `@tui/types`, and `@tui/console`.

## Tests

`pnpm test:cli` and `pnpm typecheck:cli`. `vitest.config.ts` resolves every
surface; `ink` throws, so a command that loads the TUI eagerly fails here.
`testing/fake-surfaces.ts` provides `fakeRunAgent` (typed `RunAgent`) and
`fakeStartTUI` (a real store behind `StoreUI`). `__tests__/contract.test.ts`
pins unique command names and aliases and the fakes' types.

## Typecheck layout

`tsconfig.solution.json` lists the composite projects (`tsconfig.env.json`,
`src/<surface>/tsconfig.json`, `src/__tests__/architecture`, `e2e-harness`);
`pnpm typecheck` runs `tsc -b` on it so a forbidden import fails to compile. The
root `tsconfig.json` is the whole-tree view for tsx, editors, and Vitest.
