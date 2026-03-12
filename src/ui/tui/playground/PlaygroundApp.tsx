/**
 * PlaygroundApp — Root component for the primitives playground.
 *
 * Two screens mirroring the real wizard flow:
 *   intro → (press enter) → run (tabbed demo view)
 */

import { ScreenContainer, TabContainer } from '../primitives/index.js';
import type { WizardStore } from '../store.js';
import { WelcomeDemo } from './demos/WelcomeDemo.js';
import { LayoutDemo } from './demos/LayoutDemo.js';
import { InputDemo } from './demos/InputDemo.js';
import { ProgressDemo } from './demos/ProgressDemo.js';
import { LogDemo } from './demos/LogDemo.js';
import { RunScreenDemo } from './demos/RunScreenDemo.js';
import { HealthCheckDemo } from './demos/HealthCheckDemo.js';
import { ModalDemo } from './demos/ModalDemo.js';

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
      id: 'modal',
      label: 'Modal',
      component: <ModalDemo />,
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
