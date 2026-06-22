---
name: exploring-the-wizard
description:
  Run, drive, and explore the PostHog wizard headlessly against an app —
  manipulate its state turn-by-turn over MCP (read_state / perform_action /
  run_agent), capturing TUI snapshots to view. Use when you want to test or
  explore the wizard end-to-end without a terminal.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: '2.0'
---

# Exploring the wizard as an agent

Drive a real wizard run headlessly and **manipulate its state as it happens** —
read the current screen, make the user's decision, fire the agent, snapshot the
TUI — all over MCP. The control plane lives in `e2e-harness/`; for _how_ it
works underneath, read
[`e2e-harness/ARCHITECTURE.md`](../../../e2e-harness/ARCHITECTURE.md).

## 0. Ask for the key, set up

**First, ask the user for the path to their PostHog key file** — e.g. "What's
the absolute path to your phx key file?" — plus the project id and region if you
don't have them. Clone/point at the app you'll run against as a **throwaway
`/tmp` copy** (never a real fixture). Note `WIZARD_PATH` (this repo). Never
print or commit the key — pass it by file path, below.

## 1. Drive it live over MCP (do this)

Register the `wizard-ci-mcp` server. It holds **one live `WizardStore`** for the
app and exposes it, so you drive every decision yourself:

```bash
claude mcp add wizard-ci \
  -e APP_DIR=/tmp/<the app copy> \
  -e POSTHOG_KEY_FILE=<key file path> \
  -e PROJECT_ID=<project id> \
  -e POSTHOG_REGION=us \
  -- npx tsx "$WIZARD_PATH/scripts/wizard-ci-mcp.no-jest.ts"
```

`APP_DIR` is any directory — so for an **external repo**, clone it to `/tmp` and
point `APP_DIR` at it (this is how you explore an arbitrary app, not just the
ones in `wizard-workbench/apps/`).

Then drive it turn by turn with the tools:

- **`read_state`** — current screen, run phase, secret-free session,
  tasks/status, pending question, and the actions legal right now. Call first
  and after each move.
- **`perform_action {action, params?}`** — commit a decision: `confirm_setup`,
  `dismiss_outage`, `choose` (a setup question), `set_mcp_outcome`,
  `dismiss_slack`, `keep_skills`. The action must appear in
  `read_state.actions`.
- **`render_screen`** — render the current TUI to ANSI so you can _see_ it.
- **`run_agent`** — on the `run` screen, run the **real integration agent**
  (blocks minutes); returns the final `runPhase` and next screen.

A typical walk:

```
read_state → intro            → perform_action confirm_setup
read_state → health-check      → perform_action dismiss_outage
read_state → setup (if asked)  → perform_action choose {key,value}
read_state → run               → run_agent            (the real integration)
read_state → outro             → perform_action dismiss_outro
read_state → mcp               → perform_action set_mcp_outcome {outcome:"skipped"}
read_state → slack-connect      → perform_action dismiss_slack
read_state → keep-skills        → perform_action keep_skills {kept:false}
```

`render_screen` whenever you want to see what the user would. The token is
redacted in `read_state` and `render_screen`, so anything you capture is safe to
share.

## 2. Or run it hands-off (scripted)

If you don't want to make the decisions, run the scripted profile end to end
(for apps under `wizard-workbench/apps/`):

```bash
pnpm wizard-ci <app> --e2e          # real agent, headless; writes a recording
pnpm wizard-ci-snapshots <app>       # renders each key moment → .ans + report.html
```

Replay it:
`pnpm wizard-ci --replay /tmp/wizard-e2e-<app>.recording.json --step`.

## Key facts

- **State → screen.** You never navigate; you commit a decision (an action's
  store setter) and the router re-derives the active screen. Name actions, not
  keys.
- **`run` is the only blocking step.** Everything else is an instant store
  commit; `run_agent` is the real, billable integration.
- **A green run ≠ a valid integration.** `runPhase=completed` means the flow
  finished, not that the wizard understood the framework (e.g. it'll treat a
  Wasp app as react-router). Read what it actually changed.
- **None of this ships.** The harness lives in `e2e-harness/`, out of `src/`.
