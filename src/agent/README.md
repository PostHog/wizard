# agent

Runs exactly one independent agent run per `runAgent` call.

## Owns

- `runner/`: bootstrap, switchboard, sequences (linear, orchestrator),
  harnesses.
- `gateway/`: gateway session and mint. `middleware/`: run middleware.
- `tools/`: MCP facade over the store's tool behavior.
- `detection/`: the agentic detection run the store's contract asks for.
- Prompt assembly, output signals, security adapters.

## Never contains

Ink, screens, program definitions, or session mutation outside `WizardUI`. One
exception: `runner/shared/bootstrap.ts` stamps `skillId` on the run's own
session copy before the run starts.

## May import

`@env`, `@store`, `@store/types`, `@store/programs`, and its own files.

## Public entries

`index.ts` (`runAgent`, `detectProjectsWithAgent`, `runMcpPromptViaSdk`,
`configureGatewayFromCIEnvironment`) and `types.ts`.

## Tests

`pnpm test:agent` and `pnpm typecheck:agent`. `vitest.config.ts` resolves
`@env`, `@store`, and `@agent`; `ink` throws. `testing/fake-harness.ts` records
run and task inputs behind the `AgentHarness` interface.
`__tests__/contract.test.ts` pins that both harnesses and the fake implement
`AgentHarness` and that `runAgent` is the `RunAgent` entry the cli calls.
