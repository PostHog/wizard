# scripts/

Helper scripts. The build-related ones (`generate-version.cjs`, `smoke-test.sh`,
`check-screens.tsx`, `warlock-smoke-test.ts`, `mcp-install-smoke-test.ts`) are
wired into `package.json`; `smoke-test-ci.sh` runs from the smoke-test workflow.
The rest below are **manual, runnable tools** for headless e2e and snapshots.
Each is a standalone `tsx` entry, named `*.no-jest.ts` so the test runners
ignore it.

Run from the repo root, e.g. `npx tsx scripts/<name>.no-jest.ts`.

Both e2e routes spawn the real wizard with `--ci --control-socket` in a PTY
([`e2e-harness/tui-capture.ts`](../e2e-harness/tui-capture.ts), node-pty and
`@xterm/headless`) and drive it over the control API
([`src/store/control/`](../src/store/control/)). See
[`e2e-harness/ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md).

| Script                                     | What it does                                                                                                                                                                                                                                                               | Needs                                                                                                                                                          |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`tui-snapshots.no-jest.ts`**             | Drives the program's fixed e2e profile over the socket and saves colored `SNAP_OUT/NN-<screen>.ans` frames, including within-screen progress. Writes `E2E_RESULT_JSON` when set.                                                                                           | `SNAP_OUT`, `APP_DIR`, `PROJECT_ID`, `POSTHOG_KEY_FILE` or `POSTHOG_PERSONAL_API_KEY`; `E2E_ASK=true` for ask-driven programs                                  |
| **`wizard-ci-mcp.no-jest.ts`**             | Stdio MCP server: `open_app`, `read_state`, `perform_action`, `render_screen`, `run_agent`. Screen output is plain text.                                                                                                                                                   | `open_app` requires `appDir` and `projectId`, with optional `keyFile`, `apiKey`, `region`                                                                      |
| **`chunk-manifest.no-jest.ts`**            | Prints a structural manifest of `dist/`, keyed by source-module group rather than chunk file name: which sources share a chunk and which groups each imports. Baselines live in `scripts/__fixtures__/chunk-manifest.{prod,ci}.json`; CI diffs a fresh build against them. | A built `dist/`                                                                                                                                                |
| **`controlled-headless-smoke.no-jest.ts`** | Drives a headless run over its control socket: detect, one independent run per program named, the run ledger, shutdown. Prints every request and a redacted view of every response.                                                                                        | `APP_DIR`, `PROJECT_ID`, `POSTHOG_KEY_FILE` or `POSTHOG_PERSONAL_API_KEY`, `WIZARD_CI_GATEWAY_TOKEN_FILE`; optional `POSTHOG_REGION`, `WIZARD_BIN=dist/bin.js` |
| **`wizard-ci-explore.no-jest.ts`**         | `pnpm wizard-ci-explore`: opens an app, confirms setup, reads state, prints one frame, and exits. It does not run the agent.                                                                                                                                               | `APP_DIR`, `PROJECT_ID`; optional `POSTHOG_KEY_FILE`                                                                                                           |

> You usually do not call these directly. `pnpm wizard-ci-snapshots` (in
> [wizard-workbench](https://github.com/PostHog/wizard-workbench)) orchestrates
> the snapshot route; the MCP server is registered in this repo's `.mcp.json`
> and used via the `exploring-the-wizard` skill.

`PROGRAM`, `SNAP_HARNESS`, `SNAP_SEQUENCE`, `SNAP_MODEL`, and `E2E_ASK` are
launcher environment inputs; they are not MCP tool arguments. For new runs
follow the [runner policy](../.claude/skills/wizard-development/SKILL.md).

## Credentials for full agent runs

Full snapshot runs require the personal API key (or `POSTHOG_KEY_FILE`) and
`WIZARD_CI_GATEWAY_TOKEN_FILE`, plus `PROJECT_ID`. For MCP runs, pass the
personal key through `open_app` and set the gateway token file path in the
server environment before launch. Restart the server after changing it; the
gateway path is not an MCP tool argument. Detection-only exploration needs
neither secret. See
[local credential setup](../docs/local-dev.md#credentials-for-local-ci-and-headless-runs).

## Driving the wizard yourself

Any HTTP client works against the socket. A dev build attaches the server to the
TUI with `--ci --control-socket`; every build attaches it to a headless run with
the headless flag:

```bash
mkdir -p /tmp/w
POSTHOG_WIZARD_API_KEY=phx_... npx tsx bin.ts --ci --control-socket /tmp/w/w.sock \
  --project-id <id> --region us --install-dir /tmp/app
curl -s --unix-socket /tmp/w/w.sock http://localhost/state | jq '.state.currentScreen, [.state.actions[].id]'
curl -s --unix-socket /tmp/w/w.sock -X POST -H 'content-type: application/json' -d '{}' http://localhost/actions/confirm_setup
curl -s --unix-socket /tmp/w/w.sock -X POST http://localhost/run
curl -s --unix-socket /tmp/w/w.sock 'http://localhost/state?wait=30000&since=12' | jq .state.currentScreen
curl -s --unix-socket /tmp/w/w.sock -X POST http://localhost/shutdown
```
