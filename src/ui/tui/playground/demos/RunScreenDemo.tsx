/**
 * RunScreenDemo — Renders the real RunScreen with a mock store.
 * Tasks auto-advance every 1.5s. Discovered features (Stripe, LLM)
 * are pre-populated so conditional tips appear.
 */

import { useEffect, useRef } from 'react';
import { WizardStore, TaskStatus } from '@ui/tui/store';
import { DiscoveredFeature } from '@lib/wizard-session';
import { AgentPhase } from '@lib/agent/agent-phase';
import { RunScreen } from '@ui/tui/screens/RunScreen';

const STAGE_CYCLE: AgentPhase[] = [
  AgentPhase.CodebaseScan,
  AgentPhase.SkillInstall,
  AgentPhase.DepInstall,
  AgentPhase.CodeEdits,
  AgentPhase.EnvSetup,
  AgentPhase.Dashboards,
];

const MOCK_TASKS = [
  {
    label: 'Checking project structure and finding files for event tracking',
    activeForm: 'Checking project structure',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Load skill menu and install integration-nextjs-app-router skill',
    activeForm: 'Picking the right skill',
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
  {
    label: 'Create onboarding dashboard and insight',
    activeForm: 'Building dashboard',
    status: TaskStatus.Pending,
    done: false,
  },
  {
    label: 'Verify $pageview and $autocapture are arriving',
    activeForm: 'Watching events arrive',
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

  // Cycle through every Visualizer stage on a faster timer so the playground
  // exercises each ASCII visual without needing the real agent loop.
  useEffect(() => {
    let i = 0;
    store.setCurrentStage(STAGE_CYCLE[0]);
    const timer = setInterval(() => {
      i = (i + 1) % STAGE_CYCLE.length;
      store.setCurrentStage(STAGE_CYCLE[i]);
    }, 4000);
    return () => clearInterval(timer);
  }, [store]);

  return <RunScreen store={store} />;
};
