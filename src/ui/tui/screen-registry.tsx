/**
 * Screen registry — maps screen names to React components.
 *
 * Adding a new screen:
 *   1. Create the component in screens/
 *   2. Add an entry here
 *   3. Add the screen name to the router flow (router.ts)
 *
 * App.tsx never needs to change.
 */

import type { ReactNode } from 'react';
import type { WizardStore } from './store.js';
import type { ScreenName } from './router.js';

import { OutageScreen } from './screens/OutageScreen.js';
import { IntroScreen } from './screens/IntroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { createMcpInstaller } from './services/mcp-installer.js';
import type { McpInstaller } from './services/mcp-installer.js';

export interface ScreenServices {
  mcpInstaller: McpInstaller;
}

export function createServices(): ScreenServices {
  return {
    mcpInstaller: createMcpInstaller(),
  };
}

export function createScreens(
  store: WizardStore,
  services: ScreenServices,
): Record<ScreenName, ReactNode> {
  return {
    // Overlays
    outage: <OutageScreen store={store} />,

    // Wizard flow
    intro: <IntroScreen store={store} />,
    setup: <SetupScreen store={store} />,
    run: <RunScreen store={store} />,
    mcp: <McpScreen store={store} installer={services.mcpInstaller} />,
    outro: <OutroScreen store={store} />,

    // Standalone MCP flows
    'mcp-add': <McpScreen store={store} installer={services.mcpInstaller} />,
    'mcp-remove': <McpScreen store={store} installer={services.mcpInstaller} />,
  };
}
