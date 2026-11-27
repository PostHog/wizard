---
type: web-analytics
flow: integration-v2
label: Set up web analytics
runnerSeeded: true
model_pi: openai/gpt-5.6-terra
effort_pi: medium
model_sdk: claude-sonnet-5
effort_sdk: medium
skills: [integration-mcp]
skipWhen: [webFrontend:no]
allowedTools: [Read, Glob, Grep, wizard_ask, posthog_exec]
disallowedTools: [Write, Edit, Bash, enqueue_task]
dependsOn: [capture, review]
---

## Goal

Finish web analytics for this app now that PostHog is in the code: check that
pageviews are captured on every route, add the site's domain to the project's
authorized URLs, and create one conversion goal the user confirmed. Every change
you make is in PostHog, never in the code: the code steps and their review are
already done.

### 1. Check pageview capture, read-only

Read the posthog-js init the `init` handoff names. Pageviews are covered on
every route when the init sets `defaults` to `'2025-05-24'` or a later date, or
sets `capture_pageview: 'history_change'`, or when the app captures `$pageview`
itself on each router change. A multi-page app, where every route is a full page
load, is covered by the default. Where an SPA is covered by none of these, say so
in your handoff's `conflict` with the one-line init change that fixes it.

Note the `api_host` too. A host on the app's own domain is a reverse proxy. A
`*.posthog.com` host means ad blockers can drop events: say in your report that
a reverse proxy fixes this, and do not set one up here.

### 2. Find the site's domain

Look for the app's public URL in the code: a site URL key in `.env.example`,
`metadataBase` or `site` in the framework config, `homepage` in `package.json`,
a `CNAME` file, or the domains in `vercel.json`, `netlify.toml` or `wrangler.toml`.
Never propose `localhost`, a preview deploy or a placeholder. Call `project-get`
and read `app_urls`, `autocapture_web_vitals_opt_in` and `heatmaps_opt_in`. A
domain `app_urls` already lists needs nothing.

### 3. Choose the conversion goal options

Your task input carries `conversionCandidates` from the wizard's scan, best
first, and `successRoutes`. The `capture` handoff and
`.posthog-wizard-cache/.posthog-events.json` name the events this run
instrumented. Turn each candidate into a goal definition, in this order:

1. An event: the candidate's `posthogEvent`, or the event the capture task added
   for that action. The goal is an action with one step, `{ "event": "<name>" }`.
2. A page: a success route that follows that action, such as `/thank-you` after
   the contact form. The goal is an action with one `$pageview` step whose URL
   contains the route (`url_matching: "contains"`).

A candidate with neither cannot be a goal yet: leave it out of the question and
name it in your report as an event to add. With no candidates, offer the
instrumented events that read as a conversion instead.

### 4. Ask once

Make one `wizard_ask` call, with `subject: "web-analytics"`, holding only the
questions that apply:

- `goal`, single: up to four goal options, labelled with the action and its
  definition, such as `Sign up: event "user_signed_up"`, then `Something else`
  and `Skip`. Put the best option first.
- `goal_other`, text: "If something else, the event name or page path that
  counts as a conversion. Leave it empty otherwise."
- `domain`, single: `Add https://<domain> to authorized URLs`, and `Skip`. Only
  when you found a domain `app_urls` lacks.
- `extras`, multi: `Web vitals` and `Heatmaps`, each only while it is off.

If `wizard_ask` returns an error, nobody can answer: change nothing, and put
what you would have proposed in your report.

### 5. Apply what the user chose

- Goal: call `action-list` and reuse an action with the same steps. Otherwise
  call `action-create` with the name `<Label> (conversion goal)`, the description
  `Conversion goal created during PostHog setup`, and the steps from step 3. A
  `goal_other` that starts with `/` is a page; anything else is an event name.
- Domain: call `project-settings-update` with `app_urls` set to the existing list
  plus the new URL. The field replaces the list, so always send the whole list.
- Extras: call `project-settings-update` with `autocapture_web_vitals_opt_in`
  and `heatmaps_opt_in` set to `true` for the ones the user picked.

Change nothing the user did not pick.

## How you know you succeeded

Each question reached a decided end, applied or skipped, and your handoff
carries a finished report section listing: the pageview check, the reverse proxy
status, the domain added, the settings turned on, and the conversion goal.
PostHog does not store a default conversion goal for web analytics, so link the
goal preselected:
`<PostHog app URL>/project/<project id>/web?conversionGoal.actionId=<action id>`.

Your `complete_task` status is `done` when a conversion goal exists at the end,
and `not needed` when the user skipped it.
