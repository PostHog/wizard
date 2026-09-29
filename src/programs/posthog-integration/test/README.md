# PostHog Integration — e2e test definition

[`e2e.json`](e2e.json) is this program's **test definition**: the options a
headless e2e run auto-takes at each decision point of the flow, plus a
documented `path` of every screen and what it does.

- **`program`** — the program id the file drives. The harness keys the file by
  it.
- **`profile`** — the machine-read part. The harness loads it via
  `profileFor(Program.PostHogIntegration)`
  ([`e2e-harness/profiles.ts`](../../../../e2e-harness/profiles.ts)) and asks
  `decideE2eAction` what to commit on each screen.
- **`variations`** — the switchboard runs to snapshot, each a `name` plus an
  optional `harness`, `sequence` and `model`. `variationsFor` in `profiles.ts`
  maps them by program id.
- **`path`** — the human-read part: each screen in order and the auto-decision,
  so you can see the whole walk at a glance.

It's **data, not code** — read only by the harness, never by prod, so it doesn't
ship in the bundle. To change the test path, edit `e2e.json`. To add a new
program's test path, drop an `e2e.json` that names its `program` in the program
folder's `test/`. `profiles.ts` reads every one.
