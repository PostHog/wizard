---
type: create-flag
flow: feature-flags
label: Create the example flags in PostHog
model_pi: openai/gpt-5.6-terra
effort_pi: low
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-v2-mcp]
allowedTools: [Read, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: []
---

## Goal

Make sure this PostHog project has one example flag for each side in your
`sides` input, and none for a side that is not listed:

| Side | Key | Name |
|---|---|---|
| `backend` | `wizard-example-backend-flag` | Wizard example backend flag |
| `frontend` | `wizard-example-frontend-flag` | Wizard example frontend flag |

For each flag you need:

1. Look it up by key with `feature-flag-get-definition-by-key`. One keyed
   lookup per flag; never list every flag in the project.
2. Found: reuse it as it is. Do not change its rollout or its active state.
3. Not found: create it with `create-feature-flag`, using the key and name
   above, a boolean flag with one release condition at 0% rollout, and
   `active: false`. New flags are active by default, so pass
   `active: false` explicitly. The user turns it on when they are ready.
4. Create rejected because the key already exists: another run created it
   after your lookup. Look it up by key once more and reuse it as in step 2.

Run `info` on each tool before calling it; never guess the input shape.

If a call is rejected for permissions, or the tool is hidden for a missing
scope, stop and say so in your handoff: the credentials need
`feature_flag:read` and `feature_flag:write`. Do not retry with other
tools.

## How you know you succeeded

Your handoff gives, for each flag: its side, key, id, whether you created or
reused it, whether it is active, and its URL in PostHog (the tool result's
URL, verbatim).
