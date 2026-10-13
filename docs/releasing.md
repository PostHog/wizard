# Releasing the wizard

A wizard release reaches every user on their next run. Test the release
candidate before you merge it. This doc is the release checklist. The
[handbook](https://posthog.com/handbook/wizard-and-docs/wizard-releases) keeps
the high-level view and links here.

## How a release ships

The wizard and [context mill](https://github.com/PostHog/context-mill) release
on their own cycles. Both use
[release-please](https://github.com/googleapis/release-please).

Every PR title needs a
[conventional commit](https://www.conventionalcommits.org/) prefix, such as
`feat:` or `fix:`. The
[PR title check](../.github/workflows/pr-conventional-commit.yml) enforces it.
Release-please builds the version and the [changelog](../CHANGELOG.md) from
these titles.

|                   | Wizard                                                                                                         | Context mill                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| What ships        | The `@posthog/wizard` npm package                                                                              | Skills, agent prompts, and menus                                                                                   |
| Release candidate | The open PR from `release-please--branches--main--components--wizard`                                          | The open release-please PR in the context mill repo                                                                |
| What merging does | Release-please tags `vX.Y.Z` and [`publish.yml`](../.github/workflows/publish.yml) builds and publishes to npm | Its build workflow scans the skills with Warlock, publishes a GitHub release, moves `latest`, and mirrors it to S3 |
| When users get it | Their next `npx @posthog/wizard@latest` run                                                                    | Their next wizard run, with no wizard release                                                                      |

The wizard side has two workflows. Both run on every push to `main`:

- [`release-please.yml`](../.github/workflows/release-please.yml) keeps the
  release PR up to date. When the release PR merges, it creates the tag and the
  GitHub release.
- [`publish.yml`](../.github/workflows/publish.yml) compares the version in
  `package.json` with npm. If the version is new, it runs `pnpm build` and
  `pnpm publish`, then posts to Slack. It does nothing for other merges.

Release the context mill first when both repos change. The wizard can then find
the new skills as soon as it ships.

## The release candidate

Release-please adds everything merged since the last release to the open release
PR. That PR is the release candidate. Run every check below on it before you
merge it.

Find it with:

```bash
gh pr list --head release-please--branches--main--components--wizard
```

## Pre-release checklist

### 1. Run the basic integration program by hand

Required. This is the one check you never skip.

Check out the release branch and run the default program against a
[wizard-workbench](https://github.com/PostHog/wizard-workbench) app. `pnpm try`
runs the source with `tsx`, so you do not need to build first.

```bash
gh pr checkout release-please--branches--main--components--wizard
pnpm install

cp -R ../wizard-workbench/apps/basic-integration/javascript-node/express-todo /tmp/express-todo
git -C /tmp/express-todo init -q
git -C /tmp/express-todo add -A
git -C /tmp/express-todo commit -qm baseline

pnpm try --install-dir=/tmp/express-todo
```

Then check the outro, the report, and `git -C /tmp/express-todo diff`.

To test unreleased skills, start the context mill dev server and add
`--local-context-mill`. See [local development targets](local-dev.md) for the
flags and how to start each server.

### 2. Run wizard CI on the release PR

Required. Comment on the release PR:

```
/wizard-ci sample
```

`sample` runs one app per framework, about 45 legs. The framework is the second
segment of the app path, so `basic-integration/next-js/*` and
`feature-flags/next-js/*` share one leg.

| To run                      | Comment                                                     |
| --------------------------- | ----------------------------------------------------------- |
| One app per framework       | `/wizard-ci sample`                                         |
| Every app                   | `/wizard-ci all`                                            |
| One category                | `/wizard-ci basic-integration`                              |
| One framework in a category | `/wizard-ci basic-integration/next-js`                      |
| One app                     | `/wizard-ci basic-integration/javascript-node/express-todo` |

Always name a target. A bare `/wizard-ci`, or a comment with only a pin, runs
every app.

To pair the wizard with an unreleased context mill branch, add
`context-mill:<branch>`, for example `/wizard-ci sample context-mill:my-branch`.
On a context mill release PR, the same comment takes `wizard:<branch>` instead.
An unpinned run uses `main` of the other repo.

Only repo members and collaborators can trigger it, and only on an open PR. The
bot posts a results table and updates it as each leg finishes:

- A diff leg shows an evaluator confidence score out of 5. Look for 4 or 5.
- An assertion-graded leg (`warehouse/*`, `warehouse-seeded/*`,
  `feature-flags/*`) shows a pass or fail verdict with its check count.

Every leg outside the [known broken evals](#known-broken-evals) should pass.

### 3. Test what you added

Required. Run every program or skill that the release changes by hand, in the
real TUI. Attach the evidence to your feature PR: the outro, the report, and the
diff the wizard made.

### 4. Attach snapshots

Recommended. After you run a program by hand at least once, snapshot CI can
capture the rest. Comment on a wizard PR:

```
/wizard-ci-snapshots [app] [wizard-ref] [context-mill:<ref>]
```

- `app` defaults to `basic-integration/javascript-node/express-todo`.
- `wizard-ref` defaults to the PR's own branch.
- `context-mill:<ref>` defaults to `main`.

It drives the real TUI, captures every screen, and opens a wizard-workbench PR
with the frames. CI picks the program from the app's category. It can only reach
apps in CI-capable categories, so `metrics`, `error-tracking`, and
`error-tracking-upload-source-maps` need the local sweep.

For a big release, run the full sweep on all nine programs locally with the
[prompt below](#sample-prompt-for-a-snapshot-sweep). See
[e2e-harness/ARCHITECTURE.md](../e2e-harness/ARCHITECTURE.md) for how the
harness works.

### 5. Merge and confirm

Required. Merge the release PR. Wait for the
[Publish workflow](https://github.com/PostHog/wizard/actions/workflows/publish.yml)
to finish, then confirm npm serves the new version:

```bash
npx -y @posthog/wizard@latest --version
```

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

## Sample prompt for a snapshot sweep

Paste this into Claude Code or Codex from a wizard-workbench checkout. Fill in
the release PR first.

```
Run the wizard snapshot sweep for the release PR <URL> and post the evidence to it.

Setup:
- Wizard checkout on the release branch:
  `gh pr checkout release-please--branches--main--components--wizard && pnpm install`.
  The sweep runs the wizard from source with tsx, so no build is needed.
- wizard-workbench .env has POSTHOG_PERSONAL_API_KEY (phx_), POSTHOG_WIZARD_PROJECT_ID,
  POSTHOG_REGION=us, WIZARD_PATH (the wizard checkout), and a gateway token:
  POSTHOG_GATEWAY_TOKEN (phs_) or WIZARD_CI_GATEWAY_TOKEN_FILE.
- To test unreleased skills, also set POSTHOG_WIZARD_LOCAL_CONTEXT_MILL=true and run
  the context mill dev server on port 8765 (`npm run dev` in context-mill, or `phrocs`).
  Without it, the sweep uses the released skills.

Run:
- The real-TUI snapshot sweep on all nine programs that have src/programs/<id>/test/e2e.json:
  posthog-integration, error-tracking, error-tracking-upload-source-maps, ai-observability,
  metrics, audit, replay-vision, self-driving, warehouse-source.
- For each one: `pnpm wizard-ci-snapshots <app> --program <id>` from the workbench,
  with an app from apps/ that matches the program.
- Never scope it down to one app. If a program's e2e.json is broken, stop and report it.
  Don't fix it.

Check:
- Read each run's report and the wizard log. A frame that shows the outro is not a pass.
  Check that the run did the work.
- Skip any frame that shows a token or key.

Post:
- Render each .ans frame to PNG with its colors, not raw escape codes.
- Post one PR comment with a <details> block per program, summary "<program>: <result>",
  and every frame in order inside it.
- List any program that failed, and why, at the top of the comment.
```

## Undo a release

See
[handling wizard incidents](https://posthog.com/handbook/wizard-and-docs/wizard-incidents).
To turn off security scanning without a release, use the
[Warlock kill switch](runbooks/warlock-kill-switch.md).
