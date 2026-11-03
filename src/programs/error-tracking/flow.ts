import { defineFlow } from '@programs/program-contract';

/**
 * Error tracking. The planner picks the upload subgraph and release linking
 * from the platform it finds; the graph fixes where each sits.
 */
export const flow = defineFlow({
  sink: 'test-setup',
  nodes: {
    install: { picked: true },
    init: { picked: true },
    'capture-exceptions': { dependsOn: ['install', 'init'] },
    // A root task: it asks for a key, so the question lands while code tasks run.
    credentials: { picked: true },
    configure: { picked: true, dependsOn: ['capture-exceptions'] },
    'wire-ci': { picked: true, dependsOn: ['configure', 'credentials'] },
    // After wire-ci too, because both edit the deploy pipeline.
    'link-releases': {
      picked: true,
      dependsOn: ['capture-exceptions', 'wire-ci'],
    },
    // Builds once every code edit is in; wire-ci only edits CI files, which a local build never reads.
    verify: {
      picked: true,
      dependsOn: [
        'capture-exceptions',
        'configure',
        'credentials',
        'link-releases',
      ],
    },
    report: {
      dependsOn: ['capture-exceptions', 'wire-ci', 'link-releases', 'verify'],
    },
    'test-setup': { picked: true, dependsOn: ['report'] },
  },
});
