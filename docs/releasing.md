# Releasing

The release process lives in the [handbook](https://posthog.com/handbook/wizard-and-docs/wizard-releases). This file only tracks what's broken today.

## Known broken evals

These wizard CI legs fail today for reasons that most releases do not touch. A
failure here does not block a release unless your change touches it. Last
checked on 2026-10-13.

Update this table in the PR that fixes or breaks an eval.

| Leg                                                                             | Why it fails                                                      | Link                                                                                    |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `warehouse/multi-source-next`                                                   | Postgres is not detected, so the source is never created          | [Run 37753362063](https://github.com/PostHog/wizard-workbench/actions/runs/37753362063) |
| `warehouse/zero-source`                                                         | The abort message changed, and the test still expects the old one | [Run 37753362063](https://github.com/PostHog/wizard-workbench/actions/runs/37753362063) |
| `warehouse-seeded/next-stripe`, `warehouse-seeded/next-stripe-declined`         | The Stripe source is never created                                | [Run 37753362063](https://github.com/PostHog/wizard-workbench/actions/runs/37753362063) |
| `warehouse/stripe-node`                                                         | Flaky. It failed twice in scheduled runs, then passed             | [Run 36743514167](https://github.com/PostHog/wizard-workbench/actions/runs/36743514167) |
| `feature-flags/django/django3-saas`, `feature-flags/next-js/15-app-router-saas` | The flags API returns 403, so no report is written                | [Run 36743514167](https://github.com/PostHog/wizard-workbench/actions/runs/36743514167) |
| `audit/*`                                                                       | Audit is read-only, so there is no diff and no PR to open         | [#1062](https://github.com/PostHog/wizard/issues/1062)                                  |
| `migrate/triplex`                                                               | Wizard CI never passes the required `--product` flag              |                                                                                         |
| `self-driving/*`                                                                | Self-driving cannot run in CI mode                                |                                                                                         |
| `basic-integration/flutter/localsend`                                           | The app is a git submodule, so nothing gets committed             |                                                                                         |
| `mcp-stub-drift` job                                                            | A stubbed MCP tool is missing a scope                             | [Run 36743514167](https://github.com/PostHog/wizard-workbench/actions/runs/36743514167) |

Snapshot CI has gaps too:

- The test key lacks the scopes for warehouse sources, Replay Vision,
  self-driving, and audit live data. The sweep passes those programs without
  running them. See [#1328](https://github.com/PostHog/wizard/issues/1328).
- A failed run can hang or mislabel frames. See
  [#1333](https://github.com/PostHog/wizard/issues/1333).
