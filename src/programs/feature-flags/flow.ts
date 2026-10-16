import { defineFlow } from '../flow';

/** Example flags: the planner queues install and init only where an SDK or its init is missing. */
export const flow = defineFlow({
  sink: 'report',
  nodes: {
    install: { picked: true },
    init: { picked: true },
    'create-flag': {},
    evaluate: { dependsOn: ['create-flag', 'install', 'init'] },
    report: { dependsOn: ['evaluate'] },
  },
});
