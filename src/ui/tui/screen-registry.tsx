/**
 * Screen registry — maps screen names to React components.
 *
 * Adding a new screen:
 *   1. Create the component in screens/ (or screens/<workflow>/).
 *   2. Add a `Screen` enum entry in flows.ts.
 *   3. Add an entry here.
 *   4. Reference the screen by name in the workflow's `steps` array.
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
import { AuditIntroScreen } from './screens/audit/AuditIntroScreen.js';
import { AuditRunScreen } from './screens/audit/AuditRunScreen.js';
import { AuditOutroScreen } from './screens/audit/AuditOutroScreen.js';
import { Audit3000IntroScreen } from './screens/audit-3000/Audit3000IntroScreen.js';
import { Audit3000RunScreen } from './screens/audit-3000/Audit3000RunScreen.js';
import { Audit3000OutroScreen } from './screens/audit-3000/Audit3000OutroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { KeepSkillsScreen } from './screens/KeepSkillsScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { ExitScreen } from './screens/ExitScreen.js';
import { AuthErrorScreen } from './screens/AuthErrorScreen.js';
import { WizardAskScreen } from './screens/WizardAskScreen.js';
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
    [Overlay.AuthError]: <AuthErrorScreen store={store} />,
    [Overlay.WizardAsk]: <WizardAskScreen store={store} />,

    // Wizard flow
    [Screen.Intro]: <PostHogIntegrationIntroScreen store={store} />,
    [Screen.RevenueIntro]: <RevenueIntroScreen store={store} />,
    [Screen.AgentSkillIntro]: <AgentSkillIntroScreen store={store} />,
    [Screen.AuditIntro]: <AuditIntroScreen store={store} />,
    [Screen.AuditRun]: <AuditRunScreen store={store} />,
    [Screen.AuditOutro]: <AuditOutroScreen store={store} />,
    [Screen.Audit3000Intro]: <Audit3000IntroScreen store={store} />,
    [Screen.Audit3000Run]: <Audit3000RunScreen store={store} />,
    [Screen.Audit3000Outro]: <Audit3000OutroScreen store={store} />,
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
      <McpScreen store={store} installer={services.mcpInstaller} />
    ),
    [Screen.McpRemove]: (
      <McpScreen
        store={store}
        installer={services.mcpInstaller}
        mode="remove"
      />
    ),
  };
}
