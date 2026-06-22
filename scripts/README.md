# scripts/

Helper scripts. The build-related ones (`generate-version.cjs`,
`smoke-test*.sh`, `check-screens.tsx`) are wired into `package.json`. The rest
below are **manual, runnable tools** for headless e2e + snapshots — each is a
standalone `tsx` entry, named `*.no-jest.ts` so Jest ignores it.

Run from the repo root, e.g. `npx tsx scripts/<name>.no-jest.ts`.

| Script                            | What it does                                                                                                                                                                | Needs                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **`e2e-full-run.no-jest.ts`**     | The full headless e2e: real `WizardStore` + `InkUI` (never rendered) + concurrent driver + **real `runAgent`** against prod cloud. Emits a structured result + a recording. | `POSTHOG_PERSONAL_API_KEY`, `APP_DIR`, `PROJECT_ID`; host `CLAUDE_*` env stripped |
| **`render-snapshots.no-jest.ts`** | Renders a recording's key-moment frames to per-frame `.ans` snapshots (real Ink → ANSI). Feeds the workbench visual-regression flow.                                        | a `recording.json` + outDir                                                       |
| **`replay-e2e.no-jest.ts`**       | Replays a recording in the terminal — reconstructs each frame's store and renders the **real Ink screen**. `--step` (Enter to advance) or `--delay <ms>` (auto-play).       | a `recording.json`                                                                |

> You usually don't call these directly — `pnpm wizard-ci <app> --e2e` and
> `pnpm wizard-ci-snapshots` (in
> [wizard-workbench](https://github.com/PostHog/wizard-workbench)) orchestrate
> them with the env hygiene + assertions. A real `--e2e` run drops a recording
> at `/tmp/wizard-e2e-<app>.recording.json`.

## Background

The control plane lives in [`e2e-harness/`](../e2e-harness/) — out of `src/`, so
none of it ships in prod. `WizardCiDriver` (read/act over the store), the
screen→action registry, the `wizard-ci-tools` MCP server, the e2e profiles, and
the recorder/replay. See [`ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md) for
how an agent drives these (env strip, scoped project id, gotchas).
