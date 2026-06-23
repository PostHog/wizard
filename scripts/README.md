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

| Script                          | What it does                                                                                                                                                                                          | Needs                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| **`tui-host.no-jest.ts`**       | The real-TUI host. `MODE=fixed` self-drives the fixed e2e profile and signals each screen; `MODE=serve` accepts drive commands (`read_state`/`perform_action`/`run_agent`) over a unix socket.       | `APP_DIR`, `POSTHOG_KEY_FILE`, `PROJECT_ID`; run under a PTY       |
| **`tui-snapshots.no-jest.ts`**  | CI snapshot route: spawns `tui-host` (`MODE=fixed`) in a PTY and writes the **real rendered** screen to `SNAP_OUT/NN-<screen>.txt` at each key moment. `RUN_AGENT=1` for the full run through outro. | `SNAP_OUT`, `APP_DIR`, `POSTHOG_KEY_FILE`, `PROJECT_ID`            |
| **`wizard-ci-mcp.no-jest.ts`**  | Agent route: a stdio **MCP server** that proxies `tui-host` (`MODE=serve`) — `read_state`/`perform_action`/`run_agent` forward over the socket, `render_screen` returns the real captured frame.     | spawns the host itself; key passed via `open_app`                 |
| **`wizard-ci-explore.no-jest.ts`** | Quick eyeball of the agent route: drives the MCP server (`open_app → confirm_setup → render_screen`) and prints the real TUI. `pnpm wizard-ci-explore`.                                            | `APP_DIR`, `POSTHOG_KEY_FILE`, `PROJECT_ID`                        |

> You usually don't call these directly — `pnpm wizard-ci-snapshots` (in
> [wizard-workbench](https://github.com/PostHog/wizard-workbench)) orchestrates
> the snapshot route; the MCP server is registered in this repo's `.mcp.json` and
> used via the `exploring-the-wizard` skill.

## Background

The control plane lives in [`e2e-harness/`](../e2e-harness/) — out of `src/`, so
none of it ships in prod. `WizardCiDriver` (read/act over the store), the
screen→action registry, the e2e profiles, and `tui-capture` (real-TUI PTY
capture). See [`ARCHITECTURE.md`](../e2e-harness/ARCHITECTURE.md) for how the two
routes drive these (env strip, scoped project id, gotchas).
