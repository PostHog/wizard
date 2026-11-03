import { WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY } from '@shared/constants';
import { defineFlow, type FlowContext } from '@programs/program-contract';

/** Kill switch over the shipped default: only an explicit 'false' excludes AI Observability and Logs. */
const aioLogsEnabled = ({ flags }: FlowContext) =>
  flags[WIZARD_DEFAULT_AIO_LOGS_FLAG_KEY] !== 'false';

/** The default integration: what the `integrate-posthog` planner prompt describes, as a graph. */
export const flow = defineFlow({
  sink: 'report',
  nodes: {
    install: {},
    init: {},
    identify: { dependsOn: ['install', 'init'] },
    'error-tracking': { dependsOn: ['install', 'init'] },
    capture: { dependsOn: ['identify'] },
    'ai-observability': {
      dependsOn: ['capture'],
      when: (ctx) =>
        aioLogsEnabled(ctx) && ctx.traits.callsLlmApi?.value !== 'no',
    },
    // After AI Observability: both edit the same entry and init files.
    logs: { dependsOn: ['ai-observability'], when: aioLogsEnabled },
    review: {
      dependsOn: [
        'install',
        'init',
        'identify',
        'capture',
        'error-tracking',
        'ai-observability',
        'logs',
      ],
    },
    dashboard: { dependsOn: ['capture'] },
    // Queued by the wizard from detected sources; runs after everything but the report.
    warehouse: {
      picked: true,
      dependsOn: [
        'install',
        'init',
        'identify',
        'error-tracking',
        'capture',
        'ai-observability',
        'logs',
        'review',
        'dashboard',
      ],
    },
    report: { dependsOn: ['dashboard', 'review', 'warehouse'] },
  },
});
