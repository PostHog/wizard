# scripts/

Helper scripts. The build-related ones (`generate-version.cjs`,
`smoke-test*.sh`, `check-screens.tsx`) are wired into `package.json`. The rest
below are **manual, runnable tools** for the `wizard-ci-tools` control plane and
e2e — each is a standalone `tsx` entry, named `*.no-jest.ts` so Jest ignores it.

Run from the repo root, e.g. `npx tsx scripts/<name>.no-jest.ts`.

## Control-plane e2e (drive the wizard headlessly via wizard-ci-tools)

| Script                        | What it does                                                                                                                                                                                                             | Needs                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **`ci-driver-demo.ts`**       | Drives the real store/router/detection flow with `WizardCiDriver` — **offline, agent stubbed**. Proves the control loop on a 1-file project.                                                                             | nothing                                                                           |
| **`e2e-full-run.no-jest.ts`** | The full headless e2e: real `WizardStore` + `InkUI` (never rendered) + concurrent driver + **real `runAgent`** against prod cloud. Emits a structured result (`E2E_RESULT_JSON`) and a recording (`E2E_RECORDING_JSON`). | `POSTHOG_PERSONAL_API_KEY`, `APP_DIR`, `PROJECT_ID`; host `CLAUDE_*` env stripped |
| **`ci-driver-live-agent.ts`** | A **real gateway LLM** drives the `wizard-ci-tools` MCP server (read_state / perform_action) to advance the wizard — agent-vs-agent proof.                                                                               | `PHX_KEY_FILE`                                                                    |

> Normally you don't call these directly — `pnpm wizard-ci <app> --e2e` (in
> [wizard-workbench](https://github.com/PostHog/wizard-workbench)) orchestrates
> `e2e-full-run` with the env hygiene + assertions.

## Record & replay (view a run back in the terminal)

| Script                       | What it does                                                                                                                                                                          | Needs                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **`record-demo.no-jest.ts`** | Produces a sample recording **offline** (no agent, no network) by driving the flow with a `WizardRecorder`. Writes `/tmp/wizard-demo.recording.json` (override with `RECORDING_OUT`). | nothing              |
| **`replay-e2e.no-jest.ts`**  | Replays a recording in the terminal — reconstructs each frame's store and renders the **real Ink screen**. `--step` (Enter to advance, default) or `--delay <ms>` (auto-play).        | a `*.recording.json` |

```bash
# make a sample recording, then watch it
npx tsx scripts/record-demo.no-jest.ts
npx tsx scripts/replay-e2e.no-jest.ts /tmp/wizard-demo.recording.json --step
```

Real `--e2e` runs also drop a recording at
`/tmp/wizard-e2e-<app>.recording.json`.

## Background

The control plane lives in [`src/lib/ci-driver/`](../src/lib/ci-driver/) —
`WizardCiDriver` (read/act over the store), the screen→action registry, the
`wizard-ci-tools` MCP server, the e2e profile, and the recorder/replay. See
[`ARCHITECTURE.md`](../src/lib/ci-driver/ARCHITECTURE.md) for how an agent
drives these (env strip, scoped project id, gotchas).

> **Security-leak repro scripts** (`relay-prod.no-jest.ts`,
> `precedence.no-jest.ts`) that reproduce the `ANTHROPIC_BASE_URL`
> settings-override gateway leak live on the fix PR
> ([PostHog/wizard#703](https://github.com/PostHog/wizard/pull/703)), documented
> in its description + comments.
