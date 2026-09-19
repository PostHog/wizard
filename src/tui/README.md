# tui

All rendering: Ink screens, primitives, presentation state, console renderers.

## Owns

- `App.tsx`, `start-tui.ts`, screens, primitives, components, hooks, playground.
- `ui-store.ts`: presentation state that watches the injected `WizardStore`.
- `programs/`: content decks and tips keyed by program id.
- `console/`: `LoggingUI` and `HeadlessUI`. Ink free; headless builds ship them.
- Agent work the TUI needs arrives through the store's `getMcpPromptRunner`.

## Never contains

Agent execution, or any import of `@agent` or `@cli`.

## May import

`@env`, `@store`, `@store/types`, `@store/programs`, and its own files.

## Public entries

`index.ts`, `types.ts`, and `console/index.ts`. Importing `index.ts` loads Ink;
the cli imports it lazily.

## Tests

`pnpm test:tui` and `pnpm typecheck:tui`. `vitest.config.ts` resolves `@env`,
`@store`, and `@tui`, with the no-op `ink` mock that frame tests swap for the
real package. `__tests__/contract.test.ts` pins that `LoggingUI` and
`HeadlessUI` implement `WizardUI` with `interactive: false`, that `UiStore`
satisfies `UiStoreApi`, and that every flow key a program declares is a
`ScreenId`. Frame goldens render every screen through `ink-testing-library`.
