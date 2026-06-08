/**
 * PII Bouncer abort cases.
 *
 * All detection — frontend templates, `posthog-js` presence, the
 * `posthog.init` call — lives in the `pii-bouncer` context-mill skill, not
 * here. When a prerequisite is missing the skill emits `[ABORT] <reason>`;
 * these cases map each reason to a structured terminal outro.
 *
 * The `match` regexes are the contract with the skill: the signals
 * (`no-posthog-js`, `no-init-call`, `no-frontend-templates`) must stay in
 * sync with the emitting side.
 *
 * See (emitting side): context-mill/transformation-config/skills/pii-bouncer/
 * description.md — the "Abort statuses" section.
 */

import type { AbortCase } from '@lib/agent/agent-runner';

export const PII_BOUNCER_ABORT_CASES: AbortCase[] = [
  {
    match: /^no-posthog-js$/i,
    message: 'PostHog JS is not installed',
    body:
      'The PII Bouncer protects frontend forms and session recordings. ' +
      'It needs `posthog-js` to be installed first — run the main wizard ' +
      'to integrate PostHog, then come back.',
    docsUrl: 'https://posthog.com/docs/libraries/js',
  },
  {
    match: /^no-init-call$/i,
    message: 'Could not find where PostHog is initialised',
    body:
      'The PII Bouncer needs to find where PostHog is initialised — a ' +
      '`posthog.init(...)` call or a `<PostHogProvider>` — to add session ' +
      'recording mask config. Make sure PostHog is initialised in your ' +
      'project and try again.',
    docsUrl: 'https://posthog.com/docs/libraries/js#initialization',
  },
  {
    match: /^no-frontend-templates$/i,
    message: 'No frontend templates found',
    body:
      'The PII Bouncer scans .jsx / .tsx / .vue / .svelte / .astro / .html ' +
      'files for sensitive inputs. None were found in this project.',
    docsUrl: 'https://posthog.com/docs/session-replay/privacy',
  },
];
