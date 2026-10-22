# Services

The services are part of the program layer, with the
[program contract](../programs/program-contract/index.ts) and the
[programs](../programs/README.md). They hold what programs consume: the session
store, detection, the codebase scan, the warehouse tool catalog and the
framework configs. A service knows what a program, a session or an agent run
is; code that doesn't belongs in [`src/shared`](../shared/README.md). Some
services start agent runs, such as the agentic project scan, so the services sit
above the agent. The program layer's three parts import in one direction:

```
env → shared → agent → program contract → services → programs → hosts
```

Services import `@env`, `@shared/*`, `@utils/*`, `@agent`, `@agent/types` and
the program contract, `@programs/program-contract`, which defines `ProgramConfig`,
`ProgramSession`, `RunnerContext` and `FrameworkConfig` and imports no service.
Programs import services. The hosts reach the session store through the
`@programs` entry, which re-exports it.

## Entries

Each service folder is an entry. Code outside `src/services` imports a service by its
folder, never a file inside one:

| Entry                           | What it holds                                                                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@services/session`             | `SessionStore`, `buildSession`, stored interactions, audit checks and the task stream                                                              |
| `@services/detection`           | Framework, feature and package-manager detection, the agentic project scan and project scoping                                                     |
| `@services/detection/decisions` | The Decisions service. Only dev builds load it, through an `import()` behind `!IS_PRODUCTION_BUILD`; production builds replace it with a stub      |
| `@services/frameworks`          | `FRAMEWORK_REGISTRY` and each framework's `FrameworkConfig`                                                                                        |
| `@services/codebase-scan`       | The codebase scan and its report                                                                                                                   |
| `@services/warehouse-sources`   | The warehouse tool catalog and source detection                                                                                                    |

Each entry's `index.ts` re-exports what code outside the service uses, and
nothing else. Add to it when a program needs another export.

## Imports inside the services

Files inside `src/services` import each other by relative path, across services too.
The services import each other in a loop (session, detection, frameworks,
codebase scan and tool catalog), and a value read through an entry
inside a loop can run before the entry finishes loading.

A service's own tests may import its files by the deep alias,
`@services/<service>/<file>`. A test outside `src/services` imports a service through
its entry, and may mock a service's internal module by its deep path so the mock
reaches every importer.

## Wiring

- **Project:** [`tsconfig.json`](tsconfig.json) references env, shared, the
  agent and the program contract. The programs' core project references this one.
- **Alias:** `@services/*`, in `tsconfig.base.json`, `tsconfig.no-tui.json` and
  `vitest.config.ts`.
- **Fences:** ESLint in [`.eslintrc.cjs`](../../.eslintrc.cjs) keeps relative
  imports inside `src/services` and rejects a path below an entry outside the
  layer and tests.
- **Tests:** the `services` Vitest project runs `src/services/**/__tests__`.
- **Build:** [`tsdown.config.ts`](../../tsdown.config.ts) stubs
  `src/services/detection/decisions` in production builds, matching relative and
  `@services/` specifiers. `pnpm check:decisions-bundle` verifies it.

## Session store and task streams

[`session-store.ts`](session/session-store.ts) holds one run's state. See
[the session store](../../docs/developer-interfaces.md#the-session-store).
[`task-stream-push.ts`](session/task-stream/task-stream-push.ts) pushes it to
PostHog. See
[WizardRun synchronization](../../docs/local-dev.md#wizardrun-synchronization).
