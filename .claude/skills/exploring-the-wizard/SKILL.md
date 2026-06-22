---
name: exploring-the-wizard
description: Run, drive, and explore the PostHog wizard headlessly against an app — boot it on the app and decide each screen yourself over the wizard-ci MCP tools (open_app / read_state / perform_action / run_agent), snapshotting the TUI to see what happened. Use to test or explore the wizard end-to-end.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "3.0"
---

# Exploring the wizard as an agent

Drive a real wizard run yourself: boot it on an app, read each screen, decide, act,
snapshot. You do this through the **`wizard-ci` MCP tools**, which are already bound
in this repo (registered in `.mcp.json`). For _how_ it works underneath, read
[`e2e-harness/ARCHITECTURE.md`](../../../e2e-harness/ARCHITECTURE.md).

If you don't see the `wizard-ci` tools (`open_app`, `read_state`, …), the server
isn't approved yet — ask the user to approve `wizard-ci`, then retry.

## Set up

Ask the user for the absolute path to their PostHog key file — e.g. "What's the
path to your phx key file?" — plus the project id and region if you don't have
them. Clone or copy the target app to a **throwaway `/tmp` copy** (never a real
fixture). Never print or commit the key.

## Drive

1. **`open_app({ appDir, keyFile, projectId, region })`** — boots a live wizard on
   the app and returns the first screen. Point `appDir` at the throwaway copy; for
   a monorepo, the actual app dir (the one with `package.json`).
2. **`read_state`** — current screen, run phase, secret-free session, tasks, and
   the actions legal right now. Call after every move.
3. **`perform_action({ action, params? })`** — commit a decision: `confirm_setup`,
   `dismiss_outage`, `choose` (a setup question, e.g. `{ key, value }`),
   `set_mcp_outcome`, `dismiss_slack`, `keep_skills`.
4. **`render_screen`** — render the current TUI to ANSI so you can _see_ it.
5. **`run_agent`** — on the `run` screen, the **real integration** (blocks minutes).

A typical walk:

```
open_app → intro → perform_action confirm_setup
read_state → health-check → perform_action dismiss_outage
read_state → run → run_agent            (the real integration)
read_state → outro → perform_action dismiss_outro → … → keep_skills
```

Snapshot with `render_screen` at each key moment so you (and the user) can see what
the wizard showed.

## Key facts

- **State → screen.** You never navigate; you commit a decision (an action) and the
  router re-derives the active screen. Name actions, not keys.
- **`run` is the only blocking step.** Everything else is an instant commit;
  `run_agent` is the real, billable integration.
- **A green run ≠ a valid integration.** `runPhase=completed` means the flow
  finished, not that the wizard understood the framework (e.g. it'll treat a Wasp
  app as react-router). Read what it actually changed.
- **None of this ships.** The harness lives in `e2e-harness/`, out of `src/`.
