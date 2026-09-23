# End-to-end tests for PostHog Wizard

`pnpm test:e2e` runs the Vite and Next.js test applications through the real Ink
TUI, the fixed e2e profile, and a real agent run. It captures PTY frames, checks
the structured completion result and changing run screen, then verifies the
installed dependencies and that each application builds and starts in dev and
production modes. `pnpm test:e2e Vite` or `pnpm test:e2e NextJS` selects one
application.

The runner requires `PROJECT_ID` (or `POSTHOG_WIZARD_PROJECT_ID`),
`POSTHOG_PERSONAL_API_KEY` (or `POSTHOG_KEY_FILE`), and
`WIZARD_CI_GATEWAY_TOKEN_FILE`. The last value must point to an already-issued
gateway bearer; the personal key is separate. Missing credentials fail before
the build or any fixture copy. See
[local credential setup](../docs/local-dev.md#credentials-for-local-ci-and-headless-runs).

The agent calls live PostHog services and may create dashboards or insights in
the selected project. Each run copies the committed test app into a temporary
directory, so it never changes the source fixture. The temporary copy and
captured frames are deleted after the run; `pnpm test:e2e-record` keeps them and
prints their location for investigation.

The former Jest pipe/MSW runner under this directory is not used by
`pnpm test:e2e`: it cannot drive the current interactive CLI, and its mocks do
not intercept a spawned Wizard process. The CI snapshot workflow in
`wizard-workbench` remains the primary visual parity review.
