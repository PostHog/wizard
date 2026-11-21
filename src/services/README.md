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
  `projects` whole. The match keeps one signal per file that holds a name, so
  two projects that share a package both keep it. A project's tools are those
  with a signal at or below its directory: read them with `getTools(session)`,
  the run project's by default. The warehouse lists, the email provider offer,
  the report and each project's `warehouseSources` all read that, so a sibling
  project's tools never reach the run.
- [`plan.ts`](project-discovery/plan.ts) builds the plan for one program: every
  project, the ones `appliesTo` offers, a reason for each of the others (already
  has PostHog, unsupported framework, library, tooling, workspace root), and the
  project that starts picked. A run that started inside a project keeps it, and
  so does a run at a workspace root that is an app itself. A run at any other
  workspace root takes the main app, else the only app offered, else stays where
  it started. There is a choice to make only in a monorepo: a single app is one
  project, whatever manifests sit below it. `reportProjectsDiscovered` and
  `reportProjectsSelected` send the `wizard: projects discovered` and
  `wizard: projects selected` events under discovery consent. The second carries
  the pick beside the default and each model source's main app.
- [`report.ts`](project-discovery/report.ts) is the one place discovery leaves
  the machine, as a `DiscoveryReport`. It carries the tools found at or below
  the run project, under that project's fingerprint. It needs discovery consent
  (`maySendDiscovery`) and telemetry. [`tags.ts`](project-discovery/tags.ts)
  holds the analytics tags under the same consent.
- [`fingerprint.ts`](project-discovery/fingerprint.ts) hashes the workspace for
  the report, from `runDir`.

[`flag.ts`](project-discovery/flag.ts) reads the `wizard-project-discovery`
flag:

| Value         | What runs                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| `off`         | Discovery walks from the run directory, so `rootDir` is the run directory and the run project is `.`            |
| `one-project` | The walk up to the workspace root, and the plan: a program with `appliesTo` works in one picked project per run |
| `run-lists`   | Everything in `one-project`                                                                                     |

Any other value, or a failed flag read, is `off`.

PostHog reads the report's wire names, so they keep theirs: the `wizard/scans`
endpoint, its `scanned_at`, `workspace_fingerprint`, `complete` and `tools`
fields, and the `scan_consent` analytics property. Security scanning is a
separate concern and keeps "scan" throughout.

### Project traits

A project is a directory in the repo with its traits. A trait is one thing the
wizard knows about the project's code. Traits describe the code, never the
person.

| Trait              | What it says                                                                            | Static detector                                   |
| ------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `framework`        | The framework the wizard integrates                                                     | `detectFramework` and the framework configs       |
| `frameworkVariant` | The framework's variant, such as `pages-router`                                         | The framework config's `getVariant`               |
| `callsLlmApi`      | `yes` when an LLM SDK is a dependency                                                   | Manifest lookup                                   |
| `mcpServers`       | Paths the MCP scan suggests as servers                                                  | The MCP scan, in the run project                  |
| `warehouseSources` | The kinds of data source found                                                          | The tool match, assigned by path                  |
| `posthogInstalled` | Whether a PostHog SDK is a dependency                                                   | Manifest lookup                                   |
| `installedSdks`    | The SDKs in [`traits/sdks.ts`](project-discovery/traits/sdks.ts) the project depends on | Manifest lookup                                   |
| `projectRole`      | `app`, `library` or `tooling`                                                           | The framework, the workspace and the package name |
| `workspaceRoot`    | The path of the workspace root the project belongs to; its own path on a root           | Workspace markers                                 |
| `webFrontend`      | `yes` when the project serves a web UI                                                  | The framework config's `webFrontend`              |
| `mainApp`          | `yes` on the project a source picked as the repo's main app                             | None                                              |

[`traits/registry.ts`](project-discovery/traits/registry.ts) declares every
trait once in `TRAITS`: its static detector, its fallback source and its match
key. A static detector reads one project by its path. For the run project,
`session.runProject`, it reads what the program's own detection left on the
session. For any other project it reads discovery: the walk's manifests, the
workspaces, and `Discovery.detected`, the framework and warehouse sources
discovery read in that project's directory.

Four sources say what a trait is: `static` detection, `decisions`, `agentic`
detection and the `person`. No source outranks another.

- **Writing.** Every source but static detection writes through `setTrait` in
  [`traits/store.ts`](project-discovery/traits/store.ts). The session keeps one
  `Trait<T> = { value, source, confidence }` per source on the project, in
  `claims`. Static detection is read each time, never kept.
  [`traits/adapter.ts`](project-discovery/traits/adapter.ts) turns an
  `AgenticDetectionReport`, from agentic detection or Decisions, into writes:
  `targetId` as `framework`, `recommended` as `mainApp` and `hasPostHog` as
  `posthogInstalled`. A path with no project becomes one.
- **Settling.** A trait settles when its sources agree, or when the person
  picks. When sources disagree and nobody picks, the run reads the trait's
  fallback source, the one today's code reads for it: static detection, and for
  `mainApp` agentic detection, else Decisions. The trait stays unsettled, and
  `unsettledTraits` and the project's `unsettled` list say so.
- **Selecting.** `getTraits(session, projectPath)` returns one project's settled
  traits, and `selectProjects(session, predicate)`, in
  [`traits/select.ts`](project-discovery/traits/select.ts), the projects whose
  settled traits satisfy a predicate. Call `settleProjects` once a program's
  detection has run: it keeps the run project's static detection in
  `Discovery.detected`, so a run that moves to another project still knows it,
  and refreshes the settled traits the session keeps on each project.

`toMatchKeys`, in
[`traits/match-keys.ts`](project-discovery/traits/match-keys.ts), turns the
traits skills can match on into match keys. A trait's `matchKey` is `true` to
key by its own name, or the key to use: `framework` keys as `framework` and
`frameworkVariant` as `frameworkVariant`, the tags context-mill puts on a skill.

A program's `rankWith` names the model sources that rank its projects beside
static detection: `decisions`, `agentic`, both or neither.

## Session store and task streams

[`session-store.ts`](session/session-store.ts) holds one run's state. See
[the session store](../../docs/developer-interfaces.md#the-session-store).
[`task-stream-push.ts`](session/task-stream/task-stream-push.ts) pushes it to
PostHog. See
[WizardRun synchronization](../../docs/local-dev.md#wizardrun-synchronization).
