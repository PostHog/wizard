import { defineFlow } from '@programs/program-contract';

/** One verify → instrument chain per service, which the planner fans out; the report waits for all of them. */
export const flow = defineFlow({
  sink: 'report',
  nodes: {
    'verify-sdk': { picked: true },
    'instrument-metrics': {
      picked: true,
      dependsOn: ['verify-sdk'],
      matchInputs: ['package', 'service_name'],
    },
    report: { dependsOn: ['instrument-metrics'] },
  },
});
