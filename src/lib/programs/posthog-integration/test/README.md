# PostHog Integration — e2e test path

The **test definition** for this program: the path a headless e2e run walks and
the option it auto-takes at each decision point. This is the human description;
the runnable form is the profile in
[`e2e-harness/profiles.ts`](../../../../../e2e-harness/profiles.ts)
(`profileFor(Program.PostHogIntegration)`), driven by `decideE2eAction`. Keep
the two in sync — change the path here, change the profile there.

The profile that produces this path:

```ts
{ setup: 'first', healthCheck: 'dismiss', mcp: 'skip', slack: 'skip', skills: 'delete', ask: 'first' }
```

## The path

A run walks these screens in order; `(external)` means the harness waits while
the runner or the agent advances on its own.

| #   | screen          | auto-decision                             | why                                                                                                                                            |
| --- | --------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `intro`         | **confirm & continue** (`confirm_setup`)  | start the flow                                                                                                                                 |
| 2   | `health-check`  | **dismiss any outage** (`dismiss_outage`) | `healthCheck: 'dismiss'` — proceed even if the readiness probe flags an issue                                                                  |
| 3   | `setup`         | **pick the first option** (`choose`)      | `setup: 'first'` — only appears when the framework needs disambiguation (e.g. Next.js App vs Pages router); Node/Express has no setup question |
| 4   | `auth`          | _(external)_                              | the runner injects credentials; harness waits                                                                                                  |
| 5   | `run`           | _(external)_                              | the real agent integrates the SDK + instruments events; harness waits                                                                          |
| 6   | `outro`         | **dismiss** (`dismiss_outro`)             | leave the summary                                                                                                                              |
| 7   | `mcp`           | **skip** (`set_mcp_outcome: skipped`)     | `mcp: 'skip'` — don't install the MCP server                                                                                                   |
| 8   | `slack-connect` | **skip** (`dismiss_slack`)                | `slack: 'skip'`                                                                                                                                |
| 9   | `keep-skills`   | **delete** (`keep_skills: kept=false`)    | `skills: 'delete'` — leave nothing behind. Terminal: this is the run's done-signal                                                             |

Two more the happy path doesn't normally hit, but the profile covers:

- `mcp-suggested-prompts` → **dismiss** (only if the MCP step surfaces it).
- `wizard_ask` overlay → **answer with the first option** (`ask: 'first'`). The
  integration flow disallows `wizard_ask`, so this shouldn't fire here.

## Adding a variant

To test a different path (e.g. keep skills, or install MCP), pass a flag the
harness understands (`--keep-skills` overrides `skills`), or add another profile
to `e2e-harness/profiles.ts` and select it. Don't add e2e machinery back into
this program — the path is described here, the execution lives in the harness.
