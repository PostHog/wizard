# Agentic monorepo detection (headless)

## Why it exists

Headless and CI runs detect the framework at the repo root and
install there. In a monorepo the root usually isn't an app, so we'd instrument
the wrong project or nothing at all. This finds the actual app and installs into
it.

## What it does

- Before the integration runs, an agent scans the repo and returns a report:
  every project with its path, detected framework, whether it maps to a
  supported target, whether it already has PostHog, and exactly one flagged
  `recommended` (the main user-facing app — frontend or mobile over servers,
  libs, tooling).
- We take the recommended supported project, else the first supported
  PostHog-free one, and re-point the install dir there.
- On a single-repo project it recommends `.`, so nothing moves.
- The first attempt gets 60s. A timeout or a reply with no parseable report gets
  one retry with 90s (`AGENTIC_DETECTION_FIRST_ATTEMPT_TIMEOUT_MS`,
  `AGENTIC_DETECTION_RETRY_TIMEOUT_MS`); an agent error ends the scan. If the
  scan fails or finds nothing, `session.installDir` is left untouched and the
  run uses root detection, exactly like flag-off.

## What flag gates it

- `wizard-basic-integration-agentic-detection`, default off.
- On, the scan runs; off (or a failed flag fetch), it's skipped and you're back
  on root detection.
- Read once at the start of each run.
- Locally: set
  `WIZARD_CI_FLAG_OVERRIDES='{"wizard-basic-integration-agentic-detection":"true"}'`
  on a dev/`--ci` run.

## What it affects

- Only non-interactive runs, headless and `--ci`, of `posthog-integration`,
  `error-tracking` and `replay-vision`. Interactive runs have their own detect
  step and never enter it.
- Phase: `scopeInstallDirToProject` in `src/programs/detection/project-scope.ts`,
  called from the top of each of those programs' `ciPreRun`, such as the one in
  `src/programs/posthog-integration/index.ts`.
- Detector: `detectProjectsWithAgent` in `src/programs/detection/agentic.ts`.
  Self-driving, error tracking and source maps use the same detector with their
  own choosers.
- Each run fires one `wizard: agentic detection` event tagged with the outcome
  (`flag-off | error | timeout | no-project | recommended | first-instrumentable`).
