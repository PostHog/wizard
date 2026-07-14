# Agentic monorepo detection (headless)

## Why it exists

Headless and CI basic-integration runs detect the framework at the repo root and
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
- If the scan errors or finds nothing, `session.installDir` is left untouched
  and the run falls back to the old root detection, exactly like flag-off.

## What flag gates it

- `basic-integration-agentic-detection`, default off.
- On, the scan runs; off (or a failed flag fetch), it's skipped and you're back
  on root detection.
- Read once at the start of each run.
- Locally: set
  `WIZARD_CI_FLAG_OVERRIDES='{"basic-integration-agentic-detection":"true"}'` on
  a dev/`--ci` run.

## What it affects

- Only non-interactive basic-integration runs — headless and `--ci`. Interactive
  runs have their own detect step and never enter it.
- Phase: `scopeInstallDirToProject` in `src/lib/detection/project-scope.ts`,
  called from the top of `ciPreRun` in
  `src/lib/programs/posthog-integration/index.ts`.
- Detector: `detectProjectsWithAgent` in `src/lib/detection/agentic.ts`;
  self-driving uses the same detector with its own chooser.
- Each run fires one `wizard: agentic detection` event tagged with the outcome
  (`flag-off | error | no-project | recommended | first-instrumentable`).

## What's next

- The same report is meant to feed an interactive basic-integration picker
  later, with `recommended` pre-selected as the default.
- Fuller monorepo support: suggesting and implementing a sane number of defaults
  across the projects it finds.
- Rolling this out is just moving the flag off 0%.
