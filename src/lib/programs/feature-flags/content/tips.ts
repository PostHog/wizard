import type { Tip } from '@ui/tui/components/TipsCard';

export const FEATURE_FLAGS_TIPS: Tip[] = [
  {
    id: 'payloads',
    title: 'Ship settings, not just on and off',
    description:
      'Attach a JSON payload to a flag to change copy, limits, or config without a deploy.',
  },
  {
    id: 'local-evaluation',
    title: 'Check flags without a network call',
    description:
      'Server SDKs can download your flag definitions and evaluate them locally, so a check adds no round trip.',
  },
  {
    id: 'experiments',
    title: 'Turn a flag into an experiment',
    description:
      'Give a flag variants and PostHog measures which one wins on the metrics you pick.',
  },
];

export const getTips = (): Tip[] => FEATURE_FLAGS_TIPS;
