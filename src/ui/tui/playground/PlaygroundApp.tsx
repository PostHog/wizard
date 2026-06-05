/**
 * PlaygroundApp — Root component for the primitives playground.
 *
 * Two screens mirroring the real wizard flow:
 *   intro → (press enter) → run (tabbed demo view)
 */

import { ScreenContainer, TabContainer } from '@ui/tui/primitives/index';
import type { WizardStore } from '@ui/tui/store';
import { WelcomeDemo } from './demos/WelcomeDemo.js';
import { LayoutDemo } from './demos/LayoutDemo.js';
import { InputDemo } from './demos/InputDemo.js';
import { ProgressDemo } from './demos/ProgressDemo.js';
import { LogDemo } from './demos/LogDemo.js';
import { RunScreenDemo } from './demos/RunScreenDemo.js';
import { HealthCheckDemo } from './demos/HealthCheckDemo.js';
import { DoctorReportDemo } from './demos/DoctorReportDemo.js';
import { ModalDemo } from './demos/ModalDemo.js';
import { McpDemo } from './demos/McpDemo.js';
import { KeyboardHintsDemo } from './demos/KeyboardHintsDemo.js';
import { AuditChecksDemo } from './demos/AuditChecksDemo.js';
import { LearnDeckDemo } from './demos/LearnDeckDemo.js';
import { AutonomyDemo } from './demos/AutonomyDemo.js';

interface PlaygroundAppProps {
  store: WizardStore;
}

export const PlaygroundApp = ({ store }: PlaygroundAppProps) => {
  const tabs = [
    { id: 'layout', label: 'Layout', component: <LayoutDemo /> },
    { id: 'input', label: 'Input', component: <InputDemo /> },
    { id: 'progress', label: 'Progress', component: <ProgressDemo /> },
    { id: 'logs', label: 'Logs', component: <LogDemo /> },
    {
      id: 'run',
      label: 'RunScreen',
      component: <RunScreenDemo store={store} />,
    },
    {
      id: 'health',
      label: 'HealthCheck',
      component: <HealthCheckDemo />,
    },
    {
      id: 'doctor',
      label: 'Doctor',
      component: <DoctorReportDemo />,
    },
    {
      id: 'modal',
      label: 'Modal',
      component: <ModalDemo />,
    },
    {
      id: 'mcp',
      label: 'MCP',
      component: <McpDemo store={store} />,
    },
    {
      id: 'hints',
      label: 'KeyHints',
      component: <KeyboardHintsDemo />,
    },
    {
      id: 'audit-checks',
      label: 'Audit checks',
      component: <AuditChecksDemo />,
    },
    {
      id: 'learn-deck',
      label: 'Learn deck',
      component: <LearnDeckDemo store={store} />,
    },
    {
      id: 'autonomy',
      label: 'Autonomy',
      component: <AutonomyDemo store={store} />,
    },
  ];

  return (
    <ScreenContainer
      store={store}
      screens={{
        intro: <WelcomeDemo store={store} />,
        run: (
          <TabContainer
            tabs={tabs}
            statusMessage="Primitives Playground — use arrow keys to switch tabs"
          />
        ),
      }}
    />
  );
};
