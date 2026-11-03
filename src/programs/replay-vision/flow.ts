import { defineFlow } from '@programs/program-contract';

/** Replay vision: recordings flow first, then three independent scanners. Install and init only when PostHog is missing. */
export const flow = defineFlow({
  sink: 'report',
  nodes: {
    install: { picked: true },
    init: { picked: true },
    'enable-replay': { dependsOn: ['install', 'init'] },
    'scanner-broken-experiences': { dependsOn: ['enable-replay'] },
    'scanner-user-frustration': { dependsOn: ['enable-replay'] },
    'scanner-session-summaries': { dependsOn: ['enable-replay'] },
    report: {
      dependsOn: [
        'scanner-broken-experiences',
        'scanner-user-frustration',
        'scanner-session-summaries',
      ],
    },
  },
});
