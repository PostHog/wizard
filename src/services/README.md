# Services

The services are part of the program layer, with the
[program contract](../programs/program-contract/index.ts) and the
[programs](../programs/README.md). They hold what programs consume: the session
store, detection, project discovery, the warehouse tool catalog and the
framework configs. A service knows what a program, a session or an agent run is;
code that doesn't belongs in [`src/shared`](../shared/README.md). Some services
start agent runs, such as the agentic project scan, so the services sit above
the agent. The program layer's three parts import in one direction:

```
env → shared → agent → program contract → services → programs → hosts
```

Services import `@env`, `@shared/*`, `@utils/*`, `@agent`, `@agent/types` and
the program contract, `@programs/program-contract`, which defines
`ProgramConfig`, `ProgramSession`, `RunnerContext` and `FrameworkConfig` and
imports no service. Programs import services. The hosts reach the session store
through the `@programs` entry, which re-exports it.

## Entries

Each service folder is an entry. Code outside `src/services` imports a service
by its folder, never a file inside one:

| Entry                           | What it holds                                                                                                                                 |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `@services/session`             | `SessionStore`, `buildSession`, stored interactions, audit checks and the task stream                                                         |
| `@services/detection`           | Framework, feature and package-manager detection, the agentic project scan and project scoping                                                |
| `@services/detection/decisions` | The Decisions service. Only dev builds load it, through an `import()` behind `!IS_PRODUCTION_BUILD`; production builds replace it with a stub |
| `@services/frameworks`          | `FRAMEWORK_REGISTRY` and each framework's `FrameworkConfig`                                                                                   |
| `@services/project-discovery`   | Project discovery: the repo walk, the manifest parsers, the tool match, project traits and the discovery report                               |
| `@services/warehouse-sources`   | The warehouse tool catalog, and the sources and destinations among the tools discovery found                                                  |
| `@services/mcp-servers`         | The MCP server scan: where a project's servers live, and resolving a chosen path to a target                                                  |

Each entry's `index.ts` re-exports what code outside the service uses, and
nothing else. Add to it when a program needs another export.

## Imports inside the services

Files inside `src/services` import each other by relative path, across services
too. The services import each other in a loop (session, detection, frameworks,
project discovery and tool catalog), and a value read through an entry inside a
loop can run before the entry finishes loading.

A service's own tests may import its files by the deep alias,
`@services/<service>/<file>`. A test outside `src/services` imports a service
through its entry, and may mock a service's internal module by its deep path so
the mock reaches every importer.

## Wiring

- **Project:** [`tsconfig.json`](tsconfig.json) references env, shared, the
  agent and the program contract. The programs' core project references this
  one.
- **Alias:** `@services/*`, in `tsconfig.base.json`, `tsconfig.no-tui.json` and
  `vitest.config.ts`.
- **Fences:** ESLint in [`.eslintrc.cjs`](../../.eslintrc.cjs) keeps relative
  imports inside `src/services` and rejects a path below an entry outside the
  layer and tests.
- **Tests:** the `services` Vitest project runs `src/services/**/__tests__`.
- **Build:** [`tsdown.config.ts`](../../tsdown.config.ts) stubs
  `src/services/detection/decisions` in production builds, matching relative and
  `@services/` specifiers. `pnpm check:decisions-bundle` verifies it.

## Project discovery

[`project-discovery`](project-discovery/index.ts) holds everything the wizard
learns by reading the repo. `runDiscovery` runs once per run, before the
program's detection, and keeps a `Discovery` in the session. Discovery holds
facts and decides nothing: each program reads them in its `onReady` and decides
there.

| Field          | What it holds                                                                                |
| -------------- | -------------------------------------------------------------------------------------------- |
| `rootDir`      | The directory discovery walked: the workspace root, or the run directory                     |
| `runDir`       | The directory the run started in                                                             |
| `runProject`   | The project the run started in, as a path from `rootDir`                                     |
| `mode`         | The `wizard-project-discovery` flag mode discovery ran in                                    |
| `discoveredAt` | When it ran                                                                                  |
| `files`        | The walk (`RepoFiles`): file tree, manifests, lockfiles, workspace markers, `.env` key names |
| `tools`        | The tool match (`DiscoveredTools`): catalog tools, whether the walk was complete, `failed`   |
| `projects`     | The project list (`DiscoveredProjects`): `repoType`, `workspaceTool`, workspaces, projects   |

Discovery first runs before login, where the flag answers for an anonymous user.
`rediscoverAfterLogin` runs it once more, right after login, when the flag then
gives another mode. `Discovery.mode` is the mode every later step follows.

It also writes `session.projects` and `session.runProject` through the store's
`setProjects` and `setRunProject`. A project's path is relative to `rootDir`, so
`.` is the workspace root, and `session.runProject` is the project the run
started in.

- [`walk.ts`](project-discovery/walk.ts) is the only module that reads the repo.
  `findWorkspaceRoot` takes a run directory that declares a workspace as its own
  root. Otherwise it looks up for the nearest workspace marker that holds the
  run directory, stopping at the git root, below the home directory and at a
  directory others can write. The run project is the member that holds the run
  directory, so a launch in `apps/web/src` starts in `apps/web`. `walkRepoFiles`
  walks once, the run project's subtree first. It reads manifests for package
  names, workspace markers for member globs and `.env` files for key names,
  never other file contents or `.env` values. It keeps at most 4,000 file paths:
  the run project's first, then an even share for each other manifest directory.
  `readScriptHosts` reads at most 4,000 of the templates the walk passed, once a
  catalog names script hosts. `getRepoFiles` returns the walk of the run's
  install directory, which the Decisions input renders.
- A path the walk records for showing is cleaned for a prompt and cut at 120
  characters, so it is never resolved. A manifest and a marker also keep `dir`,
  the real directory, which the project list is built from. `dir` is null for a
  directory whose name holds a character a prompt cannot carry, such as a
  control character or a backtick: that directory is no project.
- [`manifests/`](project-discovery/manifests/index.ts) holds every manifest
  parser, one ecosystem per file, and `MANIFEST_PARSERS`, the table by file
  name. [`markers.ts`](project-discovery/markers.ts) holds the workspace marker
  parsers: `pnpm-workspace.yaml`, `workspaces` in `package.json`, `turbo.json`,
  `nx.json`, `lerna.json`, `[workspace]` in `Cargo.toml`, `go.work`, `include`
  in `settings.gradle` and uv workspaces.
- [`projects.ts`](project-discovery/projects.ts) turns the walk into projects. A
  candidate is a directory with a manifest. A workspace's member globs prune the
  candidates below it that it does not name; the run project always stays.
  `repoType` is `monorepo` when some workspace root has members. `complete` is
  false when the walk hit a cap. `parentOf` gives the project that contains
  another.
- [`tools.ts`](project-discovery/tools.ts) matches PostHog's tool catalog
  against the walk's packages, `.env` key names and script hosts. Tools and
  projects fail apart: a missing catalog sets `tools.failed` and leaves
  `projects` whole.
- [`report.ts`](project-discovery/report.ts) is the one place discovery leaves
  the machine, as a `DiscoveryReport`. It carries the tools found at or below
  the run project, under the fingerprint of the folder the run started in. It
  needs discovery consent (`maySendDiscovery`) and telemetry.
  [`tags.ts`](project-discovery/tags.ts) holds the analytics tags under the same
  consent.
- [`fingerprint.ts`](project-discovery/fingerprint.ts) hashes the workspace for
  the report, from `runDir`.

[`flag.ts`](project-discovery/flag.ts) reads the `wizard-project-discovery`
flag:

| Value         | What runs                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `off`         | Discovery walks from the run directory, so `rootDir` is the run directory and the run project is `.` |
| `one-project` | The walk up to the workspace root                                                                    |
| `run-lists`   | Everything in `one-project`                                                                          |

Any other value, or a failed flag read, is `off`.

PostHog reads the report's wire names, so they keep theirs: the `wizard/scans`
endpoint, its `scanned_at`, `workspace_fingerprint`, `complete` and `tools`
fields, and the `scan_consent` analytics property. Security scanning is a
separate concern and keeps "scan" throughout.

### Project traits

A project is a directory in the repo with its traits. A trait is one thing
detection read from the project's code: its framework, the framework's variant,
whether it calls an LLM API, its MCP servers and its warehouse sources. Traits
describe the code, never the person.

[`traits/registry.ts`](project-discovery/traits/registry.ts) declares every
trait once in `TRAITS`: how static detection reads it from the session, and
whether skills can match on it. `getTraits(session, projectPath)`, in
[`traits/store.ts`](project-discovery/traits/store.ts), returns the traits
detection settled and leaves out the rest. A trait is its value alone. It does
not say whether detection or the person's answer to a setup question set it.
Detection covers the run project, `session.runProject`, so any other path has no
traits. `toMatchKeys`, in
[`traits/match-keys.ts`](project-discovery/traits/match-keys.ts), turns the
traits skills can match on into the run's match keys. `framework` is the only
one.

## Session store and task streams

[`session-store.ts`](session/session-store.ts) holds one run's state. See
[the session store](../../docs/developer-interfaces.md#the-session-store).
[`task-stream-push.ts`](session/task-stream/task-stream-push.ts) pushes it to
PostHog. See
[WizardRun synchronization](../../docs/local-dev.md#wizardrun-synchronization).
