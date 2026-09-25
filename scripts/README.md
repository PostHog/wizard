# scripts/

Helper scripts. The build-related ones (`generate-version.cjs`,
`smoke-test*.sh`, `check-screens.tsx`) are wired into `package.json`. The rest
below are **manual, runnable tools** for headless e2e + snapshots — each is a
standalone `tsx` entry, named `*.no-jest.ts` so Jest ignores it.

Run from the repo root, e.g. `npx tsx scripts/<name>.no-jest.ts`.

Both e2e routes share one primitive: the **real TUI host** runs `startTUI` (the
real ink render) and is driven purely by store state manipulation; a PTY parent
([`e2e-harness/tui-capture.ts`](../e2e-harness/tui-capture.ts), node-pty +
`@xterm/headless`) captures the real rendered screen.

| Script                             | What it does                                                                                                                                                                                                                             | Needs                                                                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **`tui-host.no-jest.ts`**          | Real TUI host: `MODE=fixed` follows a profile; `MODE=serve` accepts socket commands. `MODE` is required.                                                                                                                                 | `MODE`, `APP_DIR`, `PROJECT_ID`, key for a full run; `SNAP_CTRL` in fixed mode, `CONTROL_SOCK` in serve mode; run under a PTY |
| **`tui-snapshots.no-jest.ts`**     | Runs the fixed host and saves colored `SNAP_OUT/NN-<screen>.ans` frames, including within-screen progress.                                                                                                                               | `SNAP_OUT`, `APP_DIR`, `PROJECT_ID`, `POSTHOG_KEY_FILE` or `POSTHOG_PERSONAL_API_KEY`                                         |
| **`wizard-ci-mcp.no-jest.ts`**     | Stdio MCP server: `open_app`, `read_state`, `perform_action`, `render_screen`, `run_agent`. Screen output is plain text.                                                                                                                 | Spawns the host; `open_app` requires `appDir` and `projectId`, with optional `keyFile`, `apiKey`, `region`                    |
| **`chunk-manifest.no-jest.ts`**    | Prints a structural manifest of `dist/`: per chunk, the source files it contains and the chunks it imports, hash suffixes stripped. `--summary` prints chunk names plus the sorted source set. A reading tool, nothing diffs its output. | A built `dist/`                                                                                                               |
| **`wizard-ci-explore.no-jest.ts`** | `pnpm wizard-ci-explore`: opens an app, confirms setup, reads state, prints one frame, and exits. It does not run the agent.                                                                                                             | `APP_DIR`, `PROJECT_ID`; optional `POSTHOG_KEY_FILE`                                                                          |

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
none of it ships in prod. `WizardCiDriver` (read/act over the store), the
screen→action registry, the e2e profiles, and `tui-capture` (real-TUI PTY
capture). See [`ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md) for how the
two routes drive these (env strip, scoped project id, gotchas).
