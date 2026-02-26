/**
 * start-tui.ts — Sets up the Ink TUI renderer and InkUI.
 *
 * Single registration site for all screens and tabs.
 */

import { render } from 'ink';
import { createElement } from 'react';
import { WizardStore } from './store.js';
import { InkUI } from './ink-ui.js';
import { setUI } from '../index.js';
import { registerTab } from './tabs/tab-registry.js';
import { registerScreen } from './screens/screen-registry.js';
import { App } from './App.js';

// Screens
import { WelcomeScreen } from './screens/WelcomeScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { StatusScreen } from './screens/StatusScreen.js';

// Tabs (used by RunScreen)
import { StatusTab } from './tabs/StatusTab.js';
import { AllLogsTab } from './tabs/AllLogsTab.js';
import { HowItWorksTab } from './tabs/HowItWorksTab.js';

export function startTUI(version: string): {
  unmount: () => void;
  store: WizardStore;
} {
  const store = new WizardStore();
  store.version = version;

  // Register screens
  registerScreen({ id: 'welcome', component: WelcomeScreen });
  registerScreen({ id: 'status', component: StatusScreen });
  registerScreen({ id: 'run', component: RunScreen });
  registerScreen({ id: 'outro', component: OutroScreen });
  registerScreen({ id: 'mcp', component: McpScreen });

  // Register tabs (RunScreen reads from the tab registry)
  registerTab({ id: 'status', label: 'Status', component: StatusTab });
  registerTab({ id: 'logs', label: 'All Logs', component: AllLogsTab });
  registerTab({
    id: 'howItWorks',
    label: 'How it works',
    component: HowItWorksTab,
  });

  // Sync tab definitions to the store (for BottomTabBar)
  store.registerTabs([
    { id: 'status', label: 'Status' },
    { id: 'logs', label: 'All Logs' },
    { id: 'howItWorks', label: 'How it works' },
  ]);

  // Swap in the InkUI
  const inkUI = new InkUI(store);
  setUI(inkUI);

  // Render the Ink app
  const { unmount } = render(createElement(App, { store }));

  return { unmount, store };
}
