---
name: exploring-the-wizard
description:
  Drive the PostHog wizard headlessly against a throwaway app through wizard-ci
  MCP tools, inspect decisions, and capture the real TUI. Use for detection
  checks and end-to-end exploration.
compatibility:
  Designed for coding agents working on the PostHog wizard codebase with the
  wizard-ci MCP server.
metadata:
  author: posthog
  version: '5.0'
---

# Exploring the wizard as an agent

Drive the real TUI from this checkout using the `wizard-ci` MCP server in
`.mcp.json`. If its tools are unavailable, check registration and startup
errors; request approval only if the client reports that approval is missing.

Follow the [runner policy](../wizard-development/SKILL.md) for harness,
sequence, and gateway policy. For new exploration, launch the server with
`SNAP_HARNESS=pi`; prefer `SNAP_SEQUENCE=orchestrator` for the integration flow.
These are server environment variables, not MCP arguments. Restart an existing
server to change its environment. See the
[host architecture](../../../e2e-harness/ARCHITECTURE.md) for other programs,
overrides, and current limitations.

## Prepare the run

Copy the target app to a throwaway directory under `/tmp`: a full run edits
files and can create real PostHog resources. `open_app` replaces the active
wizard, so finish recording one app before opening another.

- **Detection only:** pass `appDir` and `projectId` (both required strings),
  with no key. Stop at `auth` without calling `run_agent`.
- **Full integration:** reuse the authorized phx key file path and project id;
  ask only for missing inputs. Prefer `keyFile` so the key stays out of tool
  arguments. Never print or commit the key. Read the
  [credential and region limitations](../../../e2e-harness/ARCHITECTURE.md#current-host-limitations)
  before starting: an inherited key can shadow `keyFile`, and the host currently
  hardcodes the US region.
- **Questions during the run:** launch the server with `E2E_ASK=true` to keep
  `wizard_ask` available in this CI session. Handle questions yourself through
  the actions below; fixed-route answer profiles do not drive the MCP route.

## Tool contract

The schema lives in
[`scripts/wizard-ci-mcp.no-jest.ts`](../../../scripts/wizard-ci-mcp.no-jest.ts).
It exposes exactly these tools:

| Tool             | Arguments                                                                    | Result                                                            |
| ---------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `open_app`       | `appDir`, `projectId`; optional `keyFile`, `apiKey`, `region` (`us` or `eu`) | First state, possibly before detection finishes                   |
| `read_state`     | None                                                                         | Current state, legal actions, and background run status           |
| `perform_action` | `action`; optional `params` object                                           | State after committing a legal action                             |
| `render_screen`  | None                                                                         | Current rendered screen as plain text, with ANSI removed          |
| `run_agent`      | None                                                                         | Starts the real program in the background and returns immediately |

Use `read_state.actions` for action ids and parameters; there is no
`list_actions` MCP tool. Framework identity is `session.integration`, with
`session.detectedFrameworkLabel` and `session.detectionComplete`. The separate
top-level `integration` field is the background status: `idle`, `running`,
`done`, or `failed`; `integrationError` holds a caught failure. Those two fields
are added by `read_state` and are absent from `perform_action` replies.

## Drive and record

This walk targets the default integration program; other programs expose their
own decisions through the same state and action contract.

1. Open the app, then poll `read_state` until `session.detectionComplete` before
   judging detection. Inspect `session.integration` and `setupQuestions`.
2. Capture `render_screen` before each decision and during task or phase
   changes. Save numbered frames such as `/tmp/wz-explore-snaps/01-intro.txt`.
3. Commit only actions currently offered. Common choices are below; the
   [action registry](../../../e2e-harness/action-registry.ts) defines the full
   set.
4. For a full run, confirm setup and call `run_agent` at `auth`. Continue
   reading state and handling overlays while it runs; polling alone cannot
   answer them.
5. Check `runPhase` (`idle`, `running`, `completed`, `error`), background
   status, and the rendered outro. On error, capture the frame and reason before
   dismissing it. An error outro can wait for dismissal while `integration`
   still says `running`; a host exit can instead surface as a socket error.
6. After successful agent completion, finish the offered outro and follow-up
   actions. For the integration flow, `session.skillsComplete` marks the tail's
   completion. Other programs can have a terminal outro or exit screen.

| Decision                                 | Action and `params`                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Confirm intro / dismiss blocking outage  | `confirm_setup` / `dismiss_outage`                                                           |
| Answer setup question                    | `choose`, `{ key, value }` from `setupQuestions`                                             |
| Answer every question in a pending batch | `answer_question`, `{ answers: { questionId: value } }`; values are strings or string arrays |
| Cancel a question batch                  | `cancel_question`                                                                            |
| Accept or decline an optional task       | `resolve_notice`, `{ keep: true }` or `{ keep: false }`                                      |
| Finish outro                             | `dismiss_outro`                                                                              |
| Record MCP outcome                       | `set_mcp_outcome`, `{ outcome: "skipped" }` or `{ outcome: "installed", clients: [...] }`    |
| Dismiss suggested prompts / Slack step   | `dismiss` / `dismiss_slack`                                                                  |
| Record keep-skills choice                | `keep_skills`, `{ kept: true }` or `{ kept: false }`                                         |

MCP and keep-skills actions commit store state; recording an outcome does not
perform the corresponding installation or cleanup. Report which outcomes were
simulated. A completed run also needs a review of the app diff and expected
integration behavior before calling the integration valid.

MCP snapshots are plain `.txt`; the CI snapshot route writes colored `.ans`
frames. Keep the screen path and failure evidence with the snapshots. Do not
stop a progressing run at an invented turn count: the MCP exposes no turn limit;
Pi's continuation and tool-call guards are described in its
[harness README](../../../src/lib/agent/runner/harness/pi/README.md).

## Sweep the workbench

Fixtures live in the sibling repo at
`wizard-workbench/apps/basic-integration/<framework>/<app>`. Copy each app with
`rsync -a`, excluding `.git`, `node_modules`, and ecosystem build/dependency
directories such as `vendor`, `venv`, `Pods`, `build`, and `dist`. Verify a
failed copy before treating null detection as a regression; remove throwaway
copies after recording their results.

The shared log is `/tmp/posthog-wizard.log`. Record its byte count before a run
and read from that count plus one afterward. Run sweeps serially so their logs
remain attributable. `read_state` omits `frameworkContext`; an empty
`setupQuestions` list alone does not prove a router mode. When necessary,
inspect the detector under [`src/frameworks/`](../../../src/frameworks/) against
the same fixture.
