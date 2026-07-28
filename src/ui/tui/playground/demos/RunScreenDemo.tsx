/**
 * RunScreenDemo — Playground demo for the agent run view.
 *
 * Renders RunScreen's tab panels directly (not RunScreen itself) and owns its
 * own tab navigation, the way HealthCheckDemo renders its components directly —
 * a nested TabContainer would fight the playground's outer one over the arrow
 * keys (Ink delivers every key to every handler), leaving the inner tabs
 * unreachable. So the outer playground keeps the arrows and this demo uses:
 *
 *   n / p   switch run-screen tab (Status, Event plan, Tail logs, Visualizer, HN)
 *
 * Tasks auto-advance every 1.5s and the visualizer stage cycles on its own.
 * Discovered features (Stripe, LLM) are pre-populated so conditional tips appear.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Box, Text, useInput } from 'ink';
import { WizardStore, TaskStatus } from '@ui/tui/store';
import { DiscoveredFeature } from '@lib/wizard-session';
import { AgentPhase } from '@lib/agent/agent-phase';
import {
  SplitView,
  ProgressList,
  LogViewer,
  EventPlanViewer,
  HNViewer,
} from '@ui/tui/primitives/index';
import type { ProgressItem, TabDefinition } from '@ui/tui/primitives/index';
import { LearnCard } from '@ui/tui/components/LearnCard';
import { TipsCard } from '@ui/tui/components/TipsCard';
import { VisualizerTab } from '@ui/tui/components/PhaseVisuals';
import { getProgramConfig } from '@lib/programs/program-registry';
import { getContentBlocks as getSkillContentBlocks } from '@lib/programs/agent-skill/content/index';
import { Colors } from '@ui/tui/styles';
import { WIZARD_LOG_FILE } from '@utils/paths';

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
  const [activeTab, setActiveTab] = useState(0);

  // Re-render whenever the mock timers mutate the store (tasks, stage, etc.).
  useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.getSnapshot(),
  );

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

  // Mirror RunScreen's tab panels (built here so the demo can drive them with
  // n/p instead of the arrow keys the outer playground TabContainer owns).
  const progressItems: ProgressItem[] = store.tasks.map((t) => ({
    label: t.label,
    activeForm: t.activeForm,
    status: t.status,
  }));

  const learnBlocks = useMemo(() => {
    const getBlocks =
      getProgramConfig(store.router.activeProgram).getContentBlocks ??
      getSkillContentBlocks;
    return getBlocks(store);
  }, [store]);

  const leftPane = store.learnCardComplete ? (
    <TipsCard store={store} />
  ) : (
    <LearnCard
      store={store}
      blocks={learnBlocks}
      onComplete={() => store.setLearnCardComplete()}
    />
  );

  const tabs: TabDefinition[] = [
    {
      id: 'status',
      label: 'Status',
      component: (
        <SplitView
          left={leftPane}
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
      component: <LogViewer filePath={WIZARD_LOG_FILE} />,
    },
    {
      id: 'visualizer',
      label: 'Visualizer',
      component: <VisualizerTab store={store} />,
    },
    { id: 'hn', label: 'HN', component: <HNViewer /> },
  ];

  // The outer playground TabContainer owns the arrow keys, so navigate with n/p.
  useInput((input) => {
    if (input === 'n') {
      setActiveTab((i) => Math.min(tabs.length - 1, i + 1));
    } else if (input === 'p') {
      setActiveTab((i) => Math.max(0, i - 1));
    }
  });

  const current = tabs[Math.min(activeTab, tabs.length - 1)];

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {current?.component}
      </Box>

      <Box height={1} />
      <Box gap={1} paddingX={1}>
        {tabs.map((tab, i) => (
          <Text
            key={tab.id}
            inverse={i === activeTab}
            color={i === activeTab ? Colors.accent : Colors.muted}
            bold={i === activeTab}
          >
            {` ${tab.label} `}
          </Text>
        ))}
      </Box>
      <Box paddingX={1}>
        <Text dimColor>n/p switch tab</Text>
      </Box>
    </Box>
  );
};
