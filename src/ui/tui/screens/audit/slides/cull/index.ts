import type { AreaSlide } from '../shared.js';

const DOCS_URL = 'https://posthog.com/docs/feature-flags/best-practices';

const slide = (area: string, intro: string[]): AreaSlide => ({
  area,
  intro,
  docsUrl: DOCS_URL,
});

export const CULL_AREA_SLIDES: AreaSlide[] = [
  slide('Rolled out', [
    'This flag is at 100% for everyone, so culling preserves the on path and removes the check.',
    'The wizard checked that no rollout conditions remain; the agent confirms the call site is a plain on/off check.',
  ]),
  slide('Off for everyone', [
    'This flag is at 0% for everyone, so culling preserves the off path and removes the check.',
    'A flag rolled back after an incident looks the same; if it reads like a kill switch, keep it.',
  ]),
  slide('Archived in PostHog', [
    'PostHog archived this flag, but the code still checks it, so culling preserves the off path and removes the check.',
    'The flag stays archived.',
  ]),
  slide('Disabled in PostHog', [
    'PostHog switched this flag off, but the code still checks it, so culling preserves the off path and removes the check.',
    'The flag stays off in PostHog.',
  ]),
  slide('Unreferenced', [
    'PostHog has this flag, but nothing in this repository evaluates it.',
    'Only this repository was scanned, so a flag read by another service or app can look unreferenced here.',
    'The agent checks bulk and computed-key reads before suggesting it.',
  ]),
  slide('Comment only', [
    'This key appears only in a comment or config string, not an evaluation.',
    'Only this repository was scanned, so a flag read by another service or app can look unreferenced here.',
    'The agent confirms that no executable evaluation exists before removing the mention.',
  ]),
  slide('Dead code', [
    'The only file checking this flag is not imported and is not a Next.js route.',
    'Only this repository was scanned, so a flag read by another service or app can look unreferenced here.',
    'The agent verifies that the file is unreachable before deleting it.',
  ]),
  slide('Deleted in PostHog', [
    'The code checks a key PostHog no longer has, so culling preserves the off path and removes the check.',
    'The agent confirms that the key is not a typo of a live flag.',
  ]),
  slide('Many call sites', [
    'Three or more files evaluate this flag directly, so the report suggests one hook or helper.',
    'Nothing is edited or disabled for this flag.',
  ]),
  slide('Healthy', [
    'This flag is live, partially rolled out or multivariate, and the code still needs it.',
    'It is kept unchanged.',
  ]),
];
