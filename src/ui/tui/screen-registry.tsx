/**
 * ScreenId registry — maps screen names to React components.
 *
 * Adding a new screen:
 *   1. Create the component in screens/ (or screens/<program>/).
 *   2. Add a `ScreenId` enum entry in screen-sequences.ts.
 *   3. Add an entry here.
 *   4. Reference the screen by name in the program's `steps` array.
 */

import type { ReactNode } from 'react';
import type { WizardStore } from './store.js';
import { ScreenId, Overlay, type ScreenName } from './router.js';

import { HealthCheckScreen } from './screens/health/HealthCheckScreen.js';
import { DoctorIntroScreen } from './screens/doctor/DoctorIntroScreen.js';
import { DoctorReportScreen } from './screens/doctor/DoctorReportScreen.js';
import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from './screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from './screens/PortConflictScreen.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';
import { RevenueIntroScreen } from './screens/RevenueIntroScreen.js';
import { MigrationIntroScreen } from './screens/MigrationIntroScreen.js';
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
    [ScreenId.Intro]: <PostHogIntegrationIntroScreen store={store} />,
    [ScreenId.RevenueIntro]: <RevenueIntroScreen store={store} />,
    [ScreenId.MigrationIntro]: <MigrationIntroScreen store={store} />,
    [ScreenId.AgentSkillIntro]: <AgentSkillIntroScreen store={store} />,
    [ScreenId.AuditIntro]: <AuditIntroScreen store={store} />,
    [ScreenId.AuditRun]: <AuditRunScreen store={store} />,
    [ScreenId.AuditOutro]: <AuditOutroScreen store={store} />,
    [ScreenId.Audit3000Intro]: <Audit3000IntroScreen store={store} />,
    [ScreenId.Audit3000Run]: <Audit3000RunScreen store={store} />,
    [ScreenId.Audit3000Outro]: <Audit3000OutroScreen store={store} />,
    [ScreenId.HealthCheck]: <HealthCheckScreen store={store} />,
    [ScreenId.DoctorIntro]: <DoctorIntroScreen store={store} />,
    [ScreenId.DoctorReport]: <DoctorReportScreen store={store} />,
    [ScreenId.Setup]: <SetupScreen store={store} />,
    [ScreenId.Auth]: <AuthScreen store={store} />,
    [ScreenId.Run]: <RunScreen store={store} />,
    [ScreenId.Mcp]: (
      <McpScreen store={store} installer={services.mcpInstaller} />
    ),
    [ScreenId.KeepSkills]: <KeepSkillsScreen store={store} />,
    [ScreenId.Outro]: <OutroScreen store={store} />,
    [ScreenId.Exit]: <ExitScreen />,

    // Standalone MCP flows
    [ScreenId.McpAdd]: (
      <McpScreen store={store} installer={services.mcpInstaller} />
    ),
    [ScreenId.McpRemove]: (
      <McpScreen
        store={store}
        installer={services.mcpInstaller}
        mode="remove"
      />
    ),
  };
}
