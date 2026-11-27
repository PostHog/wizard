# Web analytics setup in the wizard

Branch `lricoy/web-analytics-setup`. This is a prototype, behind the flag
`wizard-web-analytics-setup`.

## How the wizard sets up a web project today

The default command runs the `posthog-integration` program. It runs on the
orchestrator over Pi, and its task graph is declared in
`src/programs/posthog-integration/agent/*.md`.

1. **Detect.** `detectFramework` and the traits (`webFrontend`, `posthogSdks`,
   `callsLlmApi`, …) find the framework. The MCP-server scan and the warehouse
   source scan run beside it.
2. **Tasks.**
   - `install` adds posthog-js.
   - `init` creates the init point. It also writes the env vars through
     `set_env_values` and documents them in `.env.example`, and it handles CSP.
   - `identify`, `capture`, `error-tracking`, and on some runs `mcp-analytics`
     and `ai-observability`/`logs`.
   - `review` builds and checks the integration.
   - `dashboard` uses the MCP.
   - `report` is the sink.
   - `warehouse` is runner-seeded and asks for credentials at the end.
3. **PostHog calls.** Agents reach PostHog through `posthog_exec`, the MCP
   `exec` tool. The CLI streams its run state to
   `/api/projects/:id/wizard/sessions` and `/wizard/runs`, and its scan to
   `/wizard/scans`. It gets a gateway token from `/api/wizard/gateway_token`.
   `wizard-install-status` is an MCP tool. It covers cloud runs only, and reads
   `WizardRun` through `/wizard/installs/:run_id`.
4. **What isn't covered.** There is no reverse proxy unless the user asks; the
   `instrument-reverse-proxy` skill exists in context-mill. Nothing sets
   authorized URLs, web vitals, heatmaps or a conversion goal. Pageviews come
   from the framework example's `defaults`. `wizard audit web-analytics` (the
   `web-analytics-doctor` skill) audits a project that already has 30 days of
   pageviews. It cannot help on the first install.

## Checklist: web analytics set up end to end

| # | Item | Supported today in the MCP/API | Prototype |
|---|---|---|---|
| 1 | `$pageview` on every route, including SPA history changes (`defaults: '2025-05-24'`+ or `capture_pageview: 'history_change'`) | code only | checks it, reports a gap |
| 2 | `$pageleave` (bounce rate, session duration) | code; on with `defaults` | not checked |
| 3 | Reverse proxy | `proxy-*` tools; context-mill skill | reports status, links the fix |
| 4 | Site domain in authorized URLs (`app_urls`) | `project-get`, `project-settings-update` | asks, then appends |
| 5 | Web vitals, heatmaps | `project-settings-update` (`autocapture_web_vitals_opt_in`, `heatmaps_opt_in`) | asks, then turns them on |
| 6 | A conversion goal | `action-create` works. A **saved goal does not exist**: it lives only in the URL and localStorage | creates the action, links it preselected |
| 7 | Verified | `health-issues-list/get` (no refresh tool) | not yet |

## Design

**Detect (deterministic, no model).**
`web-analytics/conversion-candidates.ts` scans source and route files. It looks
for four kinds of conversion: sign up, checkout, book a demo and contact. Each
kind is scored on evidence:

- a route named for it, as a file (`app/signup/page.tsx`) or in code
  (`<Route path="/register">`): +3
- another tool's conversion call (`gtag('event','sign_up')`, `fbq('track','Lead')`,
  Stripe checkout, a Calendly embed): +3
- an existing `posthog.capture` with a matching name: +4
- a form in a file that already has evidence: +2

It also lists success routes, such as `/thank-you`. Tests and stories are
skipped, and the walk is bounded. The ranking breaks ties in the order sign up,
checkout, demo, contact.

**Wire into the existing flow.** There's no new program. The setup should land
in the default install, so it hooks into the existing flow in three places:

- `excludedTaskTypes` removes `web-analytics` unless the flag reads `'true'`.
- `detectedFacts` tells every task, including `capture`, the top conversion. So
  the event the goal needs gets instrumented in the same run.
- `seedTasks` queues a runner-seeded `web-analytics` task for `webFrontend`
  projects when someone can answer. It never runs in CI. It shows a consent
  notice at the start, like `warehouse`.

**Confirm and apply.** `agent/web-analytics.md` runs after `capture` and
`review`. It edits no code, and it makes one `wizard_ask` call with up to four
questions: the goal (top options, "Something else" and "Skip"), a free-text
goal, the domain, and web vitals or heatmaps. It then:

- creates an action: a one-step event action, or a `$pageview` URL-contains
  action for a success page
- appends the domain to `app_urls`, sending the whole list
- flips the toggles
- hands back `…/project/<id>/web?conversionGoal.actionId=<id>`

**Fallback.** With no candidates, it offers the instrumented events that read as
a conversion, plus free text. If the ask errors, it changes nothing and reports
what it would have proposed. A candidate with no event and no success page goes
in the report as "add this event".

## What the prototype does

These changes are all in the wizard:

- `src/programs/posthog-integration/web-analytics/`: the scanner and the
  seed/flag/fact wiring
- `agent/web-analytics.md`, registered in `agent-prompts.ts`
- 17 tests in `__tests__/web-analytics.test.ts`. They use temp-dir fixture apps:
  a Next.js SaaS, a marketing site, a React SPA with an existing capture, and an
  empty app. They cover the ranking, the routes, the CI, non-web and flag gating,
  and the facts.
- Two existing test setups were adjusted. The warehouse seed test now builds a
  real session, and the flag-gating test sets the new flag.

`tsc -b` and the full `vitest run` (4859 tests) pass. **Not yet run end to end
against a real app and model.** The prompt is untested with a live model.

## Try it locally

1. Run `pnpm install && node scripts/generate-version.cjs`.
2. Turn the step on in one of two ways:
   - Target `wizard-web-analytics-setup` to yourself in the project that serves
     the wizard's flags.
   - For a quick local hack, return `[]` from `webAnalyticsExcludedTypes`.
3. Run `pnpm try --install-dir=<app>`. A wizard-workbench Next.js app works,
   once a `/signup` page has been added.
4. Look for the "Set up web analytics" notice at the start, the questions after
   review, and an action in PostHog. The report links web analytics with the
   goal selected.

## Open questions

1. **A saved goal.** Should PostHog store a default web analytics conversion
   goal? See `docs/proposals/web-analytics-conversion-goal-api.md`. Until then
   the goal is only an action and a link.
2. **Code fixes.** The step can't edit code, because it runs after review. Should
   an SPA without history pageviews be fixed in `init` instead, by a fact or a
   commandment, rather than reported?
3. **Server-rendered apps.** Django, Rails and Laravel templates don't set
   `webFrontend`, so they get no step. Should they?
4. **Reverse proxy.** Should the step offer the managed proxy (`proxy-create`
   plus a DNS step), or keep pointing to the skill?
5. **Ranking.** Should sign up beat checkout on a tie? E-commerce would want
   checkout first. Should `product_category` from Decisions reorder the kinds?
6. **CI runs.** The step is skipped in CI. Should CI create the top candidate
   unconfirmed, or only report it?
7. **Seeding cost.** `seedTasks` gets no flags, so the scan runs even with the
   flag off. The scan is bounded, but passing flags to `seedTasks` would skip it.

## Next steps

1. Run it end to end on two or three workbench apps (Next.js, React Router,
   Astro), then tune the prompt and the scanner.
2. Add the step to an e2e profile, with the ask answered by the harness.
3. Land the backend proposal. Then save the goal through
   `project-settings-update` and drop the link workaround.
4. Add a `health-issues-refresh` tool, and verify the checklist at the end of
   the run.
5. Report the step's outcome (a goal created, the kind, the domain added) as
   wizard analytics, and add an outro line.
