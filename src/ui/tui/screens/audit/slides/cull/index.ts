import type { AreaSlide } from '../shared.js';

const DOCS_URL = 'https://posthog.com/docs/feature-flags/best-practices';
const CONSENT =
  "You'll confirm before any edit, and git diff shows exactly what moved.";
const DISABLE_ONLY =
  'The flag gets disabled in PostHog, never deleted, so re-enabling is one toggle on the flag page.';

const slide = (area: string, intro: string[]): AreaSlide => ({
  area,
  intro,
  docsUrl: DOCS_URL,
});

// One slide per ledger `area`, which the wizard seeds with the bucket name.
export const CULL_AREA_SLIDES: AreaSlide[] = [
  slide('fully-rolled-out', [
    'This flag is at 100% for everyone with no conditions. Culling keeps the on branch and removes the check.',
    CONSENT,
    DISABLE_ONLY,
  ]),
  slide('never-enabled', [
    'This flag is at 0% for everyone. Culling keeps the off branch and removes the check.',
    CONSENT,
    DISABLE_ONLY,
  ]),
  slide('archived-still-referenced', [
    'PostHog already archived this flag, but the code still checks it. Culling keeps the off branch and removes the check.',
    CONSENT,
    'Nothing changes in PostHog for this one; the flag stays archived.',
  ]),
  slide('disabled-but-referenced', [
    'This flag is switched off in PostHog, but the code still checks it. Culling keeps the off branch and removes the check.',
    CONSENT,
    'Nothing changes in PostHog for this one; the flag stays off.',
  ]),
  slide('unreferenced', [
    'PostHog has this flag, but nothing in this project evaluates it. Culling only disables the flag.',
    'If the project reads flags in bulk or by a computed key, the agent verifies that first.',
    DISABLE_ONLY,
  ]),
  slide('unreferenced-comment-only', [
    'The only place this key shows up is a comment or config string, never an evaluation. Culling disables the flag and cleans up the mention.',
    CONSENT,
    DISABLE_ONLY,
  ]),
  slide('dead-code-reference', [
    'The only file that checks this flag is not imported anywhere and is not a Next.js route. Culling deletes that file.',
    CONSENT,
    DISABLE_ONLY,
  ]),
  slide('deleted-still-referenced', [
    'The code checks a key PostHog no longer has, so it always resolves to off. Culling keeps the off branch and removes the check.',
    'The agent first checks the key is not a typo of a live flag.',
    CONSENT,
  ]),
  slide('multi-callsite-no-wrapper', [
    'Three or more files evaluate this flag directly. That is a suggestion, not a removal: the report recommends one hook or helper.',
    'Nothing is edited or disabled for this flag.',
  ]),
  slide('healthy', [
    'This flag is live, partially rolled out or multivariate, and the code still needs it. Nothing to do.',
  ]),
];
