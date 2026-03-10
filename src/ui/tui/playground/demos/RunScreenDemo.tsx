/**
 * RunScreenDemo — Renders the real RunScreen with a mock store.
 * Tasks auto-advance every 1.5s. Discovered features (Stripe, LLM)
 * are pre-populated so conditional tips appear.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react';
import { WizardStore, TaskStatus } from '../../store.js';
import { DiscoveredFeature } from '../../../../lib/wizard-session.js';
import {
  TabContainer,
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '../../primitives/index.js';
import type { ProgressItem } from '../../primitives/index.js';
import { LearnCard } from '../../components/LearnCard.js';
import { TipsCard } from '../../components/TipsCard.js';

const MOCK_TASKS = [
  {
    label: 'Checking project structure and finding files for event tracking',
    activeForm: 'Checking project structure',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Verify PostHog dependencies',
    activeForm: 'Verifying PostHog dependencies',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Generate events plan (.posthog-events.json)',
    activeForm: 'Generating events plan',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Install posthog-js and posthog-node packages',
    activeForm: 'Installing packages',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Set up environment variables',
    activeForm: 'Setting up environment variables',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Create instrumentation-client.ts',
    activeForm: 'Creating instrumentation-client.ts',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Update next.config with rewrites',
    activeForm: 'Updating next.config',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Create posthog-server.ts',
    activeForm: 'Creating posthog-server.ts',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Add PostHog capture events to project files',
    activeForm: 'Adding capture events',
    status: TaskStatus.Pending,
    done: false,
  },
];

const MOCK_EVENTS = [
  { name: 'page_viewed', description: 'Fires when a user views any page' },
  {
    name: 'button_clicked',
    description: 'Fires when the CTA button is clicked',
  },
  {
    name: 'form_submitted',
    description: 'Fires when the contact form is submitted',
  },
  {
    name: 'signup_started',
    description: 'Fires when a user begins the signup flow',
  },
];

interface RunScreenDemoProps {
  store: WizardStore;
}

export const RunScreenDemo = ({ store }: RunScreenDemoProps) => {
  const tickRef = useRef(0);
  const lastStatusRef = useRef('');

  // Seed the store with mock data on mount
  useEffect(() => {
    store.addDiscoveredFeature(DiscoveredFeature.Stripe);
    store.addDiscoveredFeature(DiscoveredFeature.LLM);
    store.setEventPlan(MOCK_EVENTS);
    store.pushStatus('Checking project structure.');
    lastStatusRef.current = 'Checking project structure.';

    // Set initial tasks
    const initial = MOCK_TASKS.map((t, i) =>
      i === 0 ? { ...t, status: TaskStatus.InProgress } : t,
    );
    store.setTasks(initial);
  }, []);

  // Auto-advance tasks every 1.5s
  useEffect(() => {
    const timer = setInterval(() => {
      tickRef.current += 1;
      const tick = tickRef.current;
      const total = MOCK_TASKS.length;
      const cycle = tick % (total + 3); // +3 for pause at end before restart

      const tasks = MOCK_TASKS.map((t, i) => {
        if (i < cycle)
          return { ...t, status: TaskStatus.Completed, done: true };
        if (i === cycle)
          return { ...t, status: TaskStatus.InProgress, done: false };
        return { ...t, status: TaskStatus.Pending, done: false };
      });

      store.setTasks(tasks);

      // Only push status when the message actually changes
      if (cycle < total) {
        const msg = MOCK_TASKS[cycle].activeForm + '...';
        if (msg !== lastStatusRef.current) {
          store.pushStatus(msg);
          lastStatusRef.current = msg;
        }
      }
    }, 1500);

    return () => clearInterval(timer);
  }, []);

  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  const statuses =
    store.statusMessages.length > 0 ? store.statusMessages : undefined;

  const tabs = [
    {
      id: 'status',
      label: 'Status',
      component: (
        <SplitView
          left={
            store.learnCardComplete ? (
              <TipsCard store={store} />
            ) : (
              <LearnCard
                store={store}
                onComplete={() => store.setLearnCardComplete()}
              />
            )
          }
          right={<ProgressList items={progressItems} title="Tasks" />}
        />
      ),
    },
    ...(store.eventPlan.length > 0
      ? [
          {
            id: 'events',
            label: 'Event plan',
            component: <EventPlanViewer events={store.eventPlan} />,
          },
        ]
      : []),
    {
      id: 'logs',
      label: 'Tail logs',
      component: <LogViewer filePath="/tmp/posthog-wizard.log" />,
    },
    {
      id: 'hn',
      label: 'HN',
      component: <HNViewer />,
    },
  ];

  return (
    <TabContainer
      tabs={tabs}
      statusMessage={statuses}
      expandableStatus
      store={store}
    />
  );
};
