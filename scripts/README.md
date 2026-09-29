# scripts/

Helper scripts. `generate-version.cjs`, `smoke-test.sh` and
`mcp-install-smoke-test.ts` run from `package.json` scripts; the smoke-test
workflow runs `smoke-test-ci.sh`. The Warlock release gate, `pnpm test:warlock`,
sits beside the policy it tests, in
[`src/agent/__tests__/warlock-smoke.no-jest.ts`](../src/agent/__tests__/warlock-smoke.no-jest.ts).
Scripts import the wizard only through public entries, like the e2e harness; see
[`ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md#the-pieces). The rest below
are **manual, runnable tools** for headless e2e + snapshots — each is a
standalone `tsx` entry, named `*.no-jest.ts` so Vitest skips it and `postbuild`
drops it from `dist/`.

Run from the repo root, e.g. `npx tsx scripts/<name>.no-jest.ts`.

Both e2e routes share one primitive: the **real TUI host** runs `runTui` (the
real ink render) and is driven purely through its control target; a PTY parent
([`e2e-harness/tui-capture.ts`](../e2e-harness/tui-capture.ts), node-pty +
`@xterm/headless`) captures the real rendered screen.

| Script                             | What it does                                                                                                                                                                                                                             | Needs                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **`tui-host.no-jest.ts`**          | Real TUI host: `MODE=fixed` (the default) follows a profile; `MODE=serve` accepts socket commands.                                                                                                                                       | `APP_DIR`, `PROJECT_ID`, key for a full run, `SNAP_CTRL` in fixed mode; run under a PTY, with `CONTROL_SOCK` in serve mode |
| **`tui-snapshots.no-jest.ts`**     | Runs the fixed host and saves colored `SNAP_OUT/NN-<screen>.ans` frames, including within-screen progress.                                                                                                                               | `SNAP_OUT`, `APP_DIR`, `PROJECT_ID`, `POSTHOG_KEY_FILE` or `POSTHOG_PERSONAL_API_KEY`                                      |
| **`wizard-ci-mcp.no-jest.ts`**     | Stdio MCP server: `open_app`, `read_state`, `perform_action`, `render_screen`, `run_agent`. Screen output is plain text.                                                                                                                 | Spawns the host; `open_app` requires `appDir` and `projectId`, with optional `keyFile`, `apiKey`, `region`                 |
| **`chunk-manifest.no-jest.ts`**    | Prints a structural manifest of `dist/`: per chunk, the source files it contains and the chunks it imports, hash suffixes stripped. `--summary` prints chunk names plus the sorted source set. A reading tool, nothing diffs its output. | A built `dist/`                                                                                                            |
| **`wizard-ci-explore.no-jest.ts`** | `pnpm wizard-ci-explore`: opens an app, confirms setup, reads state, prints one frame, and exits. It does not run the agent.                                                                                                             | `APP_DIR`, `PROJECT_ID`; optional `POSTHOG_KEY_FILE`                                                                       |
| **`tui-replay.no-jest.ts`**        | `pnpm wizard-ci-replay <dir> [--step \| --delay <ms>]`: steps through or auto-plays the `NN-<screen>.txt` frames in a directory. It skips the `.ans` frames `tui-snapshots` writes.                                                      | A directory of `.txt` frames                                                                                               |
| **`a3-fault-probe.no-jest.ts`**    | Runs `runAgent` once against a local fault gateway and prints a `WIZARD_FAULT_RESULT` line.                                                                                                                                              | `WIZARD_FAULT_GATEWAY_URL`, `WIZARD_FAULT_INSTALL_DIR`, `WIZARD_FAULT_HARNESS`                                             |

> You usually don't call these directly — `pnpm wizard-ci-snapshots` (in
> [wizard-workbench](https://github.com/PostHog/wizard-workbench)) orchestrates
> the snapshot route; the MCP server is registered in this repo's `.mcp.json`
> and used via the `exploring-the-wizard` skill.

`PROGRAM`, `SNAP_HARNESS`, `SNAP_SEQUENCE`, `SNAP_MODEL`, and `E2E_ASK` are host
environment inputs, inherited from the launcher; they are not MCP tool
arguments. For new runs follow the
[runner policy](../.claude/skills/wizard-development/SKILL.md). Read the
[current host limitations](../e2e-harness/ARCHITECTURE.md#current-host-limitations)
before choosing credentials or an EU project.

## Credentials for full agent runs

Full TUI host and snapshot runs require both the personal API key (or
`POSTHOG_KEY_FILE`) and `WIZARD_CI_GATEWAY_TOKEN_FILE`, plus `PROJECT_ID`. For
MCP runs, pass the personal key through `open_app` and set the gateway token
file path in the server environment before launch. Restart the server after
changing it; the gateway path is not an MCP tool argument. Detection-only
exploration does not need either secret. See
[local credential setup](../docs/local-dev.md#credentials-for-local-ci-and-headless-runs).

## Background

The control plane lives in [`e2e-harness/`](../e2e-harness/) — out of `src/`, so
none of it ships in prod. `WizardCiDriver` (read/act over the TUI's control
target), the profile loader (`profiles.ts`, which reads each
`src/programs/<id>/test/e2e.json`), and `tui-capture` (real-TUI PTY capture).
See [`ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md) for how the two routes
drive these (env strip, scoped project id, gotchas).
