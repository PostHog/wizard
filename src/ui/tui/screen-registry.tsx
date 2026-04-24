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
import { Screen, Overlay, type ScreenName } from './router.js';

import { HealthCheckScreen } from './screens/health/HealthCheckScreen.js';
import { DoctorIntroScreen } from './screens/doctor/DoctorIntroScreen.js';
import { DoctorReportScreen } from './screens/doctor/DoctorReportScreen.js';
import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from './screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from './screens/PortConflictScreen.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';
import { RevenueIntroScreen } from './screens/RevenueIntroScreen.js';
import { AgentSkillIntroScreen } from './screens/AgentSkillIntroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { KeepSkillsScreen } from './screens/KeepSkillsScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { ExitScreen } from './screens/ExitScreen.js';
import { AuthErrorScreen } from './screens/AuthErrorScreen.js';
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
    [Overlay.SettingsOverride]: <SettingsOverrideScreen store={store} />,
    [Overlay.ManagedSettings]: <ManagedSettingsScreen store={store} />,
    [Overlay.PortConflict]: <PortConflictScreen store={store} />,
    [Overlay.AuthError]: <AuthErrorScreen />,

    // Wizard flow
    [Screen.Intro]: <PostHogIntegrationIntroScreen store={store} />,
    [Screen.RevenueIntro]: <RevenueIntroScreen store={store} />,
    [Screen.AgentSkillIntro]: <AgentSkillIntroScreen store={store} />,
    [Screen.HealthCheck]: <HealthCheckScreen store={store} />,
    [Screen.DoctorIntro]: <DoctorIntroScreen store={store} />,
    [Screen.DoctorReport]: <DoctorReportScreen store={store} />,
    [Screen.Setup]: <SetupScreen store={store} />,
    [Screen.Auth]: <AuthScreen store={store} />,
    [Screen.Run]: <RunScreen store={store} />,
    [Screen.Mcp]: <McpScreen store={store} installer={services.mcpInstaller} />,
    [Screen.KeepSkills]: <KeepSkillsScreen store={store} />,
    [Screen.Outro]: <OutroScreen store={store} />,
    [Screen.Exit]: <ExitScreen />,

    // Standalone MCP flows
    [Screen.McpAdd]: (
      <McpScreen store={store} installer={services.mcpInstaller} standalone />
    ),
    [Screen.McpRemove]: (
      <McpScreen
        store={store}
        installer={services.mcpInstaller}
        mode="remove"
        standalone
      />
    ),
  };
}
