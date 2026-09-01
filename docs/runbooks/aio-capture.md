# Runbook: AI observability capture (`--capture-aio`)

**Purpose:** mirror the wizard's own LLM calls into the developer's PostHog
project so you can watch them in the AI Observability tab while iterating.

**Owner:** wizard team · **Availability:** dev / test builds only — the flag
is stripped from published builds. Not a customer feature.

---

## What it does

Every assistant turn from either agent harness (`anthropic` and `pi`) is
composed into a `$ai_generation` event and POSTed to `${apiHost}/capture/`
using the OAuth session's project write key (`credentials.projectApiKey`).
The event lands in the AI Observability tab of whichever project the
developer OAuth'd into. No new credentials, no separate mirror project — the
one OAuth session is enough.

The primary LLM gateway path is untouched; this is a passive read of the
message stream on the way back to the wizard. Failures are debug-logged
and never surface to the run.

---

## How to enable it

Local dev against a test app:

```bash
pnpm try --install-dir=<path> -- --capture-aio
```

Any wizard subcommand accepts it (`audit`, `revenue-analytics`, etc.):

```bash
pnpm try --install-dir=<path> -- audit events --capture-aio
```

Env var equivalent:

```bash
POSTHOG_WIZARD_CAPTURE_AIO=true pnpm try --install-dir=<path>
```

---

## What you'll see

Open the AI Observability tab in the project you OAuth'd into. Filter events
by:

- `program_id` — which wizard program (e.g. `posthog-integration`)
- `integration` — detected framework (e.g. `nextjs`)
- `run_id` — a single wizard run's trace id (matches `$ai_trace_id`)
- `build` — `dev` / `ci` / `prod`
- `skill_id` — installed skill, when the run has one

Each event carries model, output content, token counts (input / output /
cache read / cache creation), and latency measured wall-clock between
assistant turns on the same stream.

---

## Production builds strip the flag

The flag is declared inside `if (!IS_PRODUCTION_BUILD)` in `src/wizard.ts`,
alongside `--ci` / `--harness` / `--sequence` / `--model`. Published builds
reject `--capture-aio` and `POSTHOG_WIZARD_CAPTURE_AIO` at parse time with a
clear message. This keeps the surface area of the shipped CLI free of a
dev-only concern.

---

## What's not covered

- **`agents-platform` harness** — placeholder today (`README` only). When it
  lands, whoever builds it needs to add a third transform + wire point in
  `src/lib/agent/aio-capture.ts`. Search for `captureFromPiMessageEndEvent`
  for the pattern.
- **Non-assistant messages** — user turns, tool results, and system messages
  don't get their own `$ai_generation`. Tool calls ride as content blocks
  inside the assistant turn's `$ai_output_choices`.
- **Cross-region mirror** — the module always POSTs to the session's own
  `apiHost`. There's no support today for sending to a different region than
  the one you OAuth'd into.
