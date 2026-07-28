---
name: exploring-the-wizard
description: Run, drive, and explore the PostHog wizard headlessly against an app — boot it on the app and decide each screen yourself over the wizard-ci MCP tools (open_app / read_state / perform_action / run_agent), snapshotting the TUI to see what happened. Use to test or explore the wizard end-to-end.
compatibility: Designed for Claude Code working on the PostHog wizard codebase.
metadata:
  author: posthog
  version: "4.0"
---

# Exploring the wizard as an agent

Drive a real wizard run yourself: boot it on an app, read each screen, decide,
act, snapshot.

## The MCP server

Everything goes through the **`wizard-ci` MCP server**, registered in this
repo's `.mcp.json` (`npx tsx scripts/wizard-ci-mcp.no-jest.ts`) — it runs the
wizard from **this checkout's source**, so whatever branch you're on is what
you're testing. If the tools (`open_app`, `read_state`, …) aren't available,
the server isn't approved yet — ask the user to approve `wizard-ci`, then
retry. For how the harness works underneath, read
[`e2e-harness/ARCHITECTURE.md`](../../../e2e-harness/ARCHITECTURE.md).

## What it can do

- **Boot the real TUI** on any app directory and walk every pre-auth screen:
  framework detection, gatherContext, feature discovery, warehouse scan,
  intro, setup questions, health check, auth.
- **Run the real integration** (`run_agent`): OAuth-equivalent bootstrap, the
  full agent run, outro, MCP install, skills — creating **real PostHog
  resources** (dashboard + insights) in the target project.
- **Show you every screen** (`render_screen`) exactly as a user sees it.
- What it can't do: drive two apps at once (`open_app` replaces the active
  wizard), or advance `auth`/`run` without credentials.

## Credentials

Two modes — pick by how far the run must go:

- **Detection-only (no credentials).** `open_app` needs just
  `{ appDir, projectId }`. Everything up to and including the `auth` screen
  runs credential-free — enough to regression-test detection, setup
  questions, and screen flow. End the run at `auth`.
- **Full run (credentials required)** — anything past `auth`, i.e.
  `run_agent`. Prompt the user for three things before starting:
  1. **Key** — ask "What's the path to your phx key file?" and pass it as
     `keyFile` (preferred: keeps the key out of logs). If they hold the key
     in an environment variable instead, have them write it to a file first
     (`printenv THEIR_VAR > /tmp/phx-key` — you never echo it) or pass
     `apiKey` inline as a last resort. Never print or commit the key.
  2. **Project id** — the PostHog project the key is scoped to (`projectId`).
  3. **Region** — `us` (default) or `eu` (`region`).

Always copy the target app to a **throwaway `/tmp` copy** (never a real
fixture) — the run edits files.

## How to drive it

1. **`open_app({ appDir, projectId, keyFile?, region? })`** — boots a live
   wizard on the app and returns the first screen.
2. **`read_state`** — current screen, run phase, secret-free session, tasks,
   and the actions legal right now. Call after every move.
3. **`perform_action({ action, params? })`** — commit a decision:
   `confirm_setup`, `dismiss_outage`, `choose` (a setup question, e.g.
   `{ key, value }`), `set_mcp_outcome`, `dismiss_slack`, `keep_skills`.
4. **`render_screen`** — render the current TUI to ANSI so you can _see_ it.
5. **`run_agent`** — kicks off the **real integration** in the background and
   returns immediately; it bootstraps credentials, so it's what advances
   `auth` and `run`. Then **poll `read_state`** — `runPhase` goes
   `running → completed` and the screen advances to `outro`.

A typical full walk:

```
open_app → intro → perform_action confirm_setup
read_state → health-check → perform_action dismiss_outage
read_state → auth → run_agent           (returns at once; integration runs in background)
read_state (poll) → runPhase running → completed, screen → outro
outro → perform_action dismiss_outro → … → keep_skills
```

A detection-only walk (no key):

```
open_app → read_state (poll until detectionComplete) →
check integration / detectedFrameworkLabel → confirm_setup → auth → done, next app
```

Snapshot with `render_screen` at each key moment and save each frame to a
numbered file — `/tmp/wz-explore-snaps/NN-<screen>.txt`, incrementing `NN` in
visit order — so the run leaves a readable, ordered record you and the user
can review afterward (the same shape the CI route's `.txt` frames take).
Capture the run screen as it progresses, not just on screen changes.

## Sweeping the workbench

The fixture library lives at
`wizard-workbench/apps/basic-integration/<framework>/<app>` (sibling repo).
To regression-test detection across every framework, loop the detection-only
walk over each app. Learned the hard way:

- **Copy with `rsync -a --exclude node_modules --exclude .git`** (plus
  vendor/venv/Pods/build/dist). A plain `cp -R` of the workbench fills the
  disk, and a copy that dies mid-write leaves a truncated app that detects as
  `null` — a false regression. If detection returns `null` unexpectedly, check
  the fixture (`package.json` present?) before blaming the code.
- **`open_app` returns the first paint**, sometimes before detection lands
  (`detectionComplete: false`, `integration: null`). Poll `read_state` —
  slower detectors (laravel, rails) need a beat.
- **Logs:** every run appends to `/tmp/posthog-wizard.log`. Record
  `wc -c < /tmp/posthog-wizard.log` before the sweep and slice with
  `tail -c +OFFSET` after — that's the run's own log, greppable for
  detection lines and `[bounded-fs]` cap warnings.
- **Router modes and other `gatherContext` results don't appear in
  `read_state` or the log.** An empty `setupQuestions` implies the mode
  resolved (ambiguity would raise a question), but for positive proof call
  the util directly with `npx tsx` against the same fixture (e.g.
  `getNextJsRouter`, `getTanStackRouterMode`).
- **Delete fixtures as you go** — a full sweep is multiple GB.

## Key facts

- **State → screen.** You never navigate; you commit a decision (an action) and the
  router re-derives the active screen. Name actions, not keys.
- **`auth` and `run` advance only via `run_agent`.** They expose no action and
  don't self-advance. `run_agent` returns immediately and runs the integration in
  the background — poll `read_state` for `runPhase` (`running → completed`).
  Everything else is an instant commit.
- **`run_agent` creates real PostHog resources** (a dashboard + insights) in the
  project; each run duplicates them.
- **A green run ≠ a valid integration.** `runPhase=completed` means the flow
  finished, not that the wizard understood the framework (e.g. it'll treat a Wasp
  app as react-router). Read what it actually changed.
- **None of this ships.** The harness lives in `e2e-harness/`, out of `src/`.
