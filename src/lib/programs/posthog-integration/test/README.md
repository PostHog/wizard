# PostHog Integration — e2e test definition

[`e2e.json`](e2e.json) is this program's **test definition**: the options a
headless e2e run auto-takes at each decision point of the flow, plus a
documented `path` of every screen and what it does.

- **`profile`** — the machine-read part. The harness loads it via
  `profileFor(Program.PostHogIntegration)`
  ([`e2e-harness/profiles.ts`](../../../../../e2e-harness/profiles.ts)) and asks
  `decideE2eAction` what to commit on each screen.
- **`path`** — the human-read part: each screen in order and the auto-decision,
  so you can see the whole walk at a glance.

It's **data, not code** — imported only by the harness, never by prod, so it
doesn't ship in the bundle. To change the test path, edit `e2e.json`. To add a
new program's test path, drop an `e2e.json` in its own `test/` folder and map it
in `profiles.ts`.
