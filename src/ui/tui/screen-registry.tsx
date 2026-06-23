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
import { ManualAuthCodeScreen } from './screens/ManualAuthCodeScreen.js';
import { PostHogIntegrationIntroScreen } from './screens/PostHogIntegrationIntroScreen.js';
import { RevenueIntroScreen } from './screens/RevenueIntroScreen.js';
import { WarehouseIntroScreen } from './screens/WarehouseIntroScreen.js';
import { MigrationIntroScreen } from './screens/MigrationIntroScreen.js';
import { SourceMapsIntroScreen } from './screens/SourceMapsIntroScreen.js';
import { SourceMapsDetectScreen } from './screens/SourceMapsDetectScreen.js';
import { SourceMapsOutroScreen } from './screens/SourceMapsOutroScreen.js';
import { AgentSkillIntroScreen } from './screens/AgentSkillIntroScreen.js';
import { SelfDrivingIntroScreen } from './screens/SelfDrivingIntroScreen.js';
import { AuditIntroScreen } from './screens/audit/AuditIntroScreen.js';
import { AuditRunScreen } from './screens/audit/AuditRunScreen.js';
import { AuditOutroScreen } from './screens/audit/AuditOutroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { AiOptInRequiredScreen } from './screens/AiOptInRequiredScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { McpSuggestedPromptsScreen } from './screens/McpSuggestedPromptsScreen.js';
import { SlackConnectScreen } from './screens/SlackConnectScreen.js';
import { KeepSkillsScreen } from './screens/KeepSkillsScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { ExitScreen } from './screens/ExitScreen.js';
import { AuthErrorScreen } from './screens/AuthErrorScreen.js';
import { SessionTimeoutScreen } from './screens/SessionTimeoutScreen.js';
import { WizardAskScreen } from './screens/WizardAskScreen.js';
import { createMcpInstaller } from './services/mcp-installer.js';
import type { McpInstaller } from './services/mcp-installer.js';
import { createMcpSuggestedPromptsServices } from './services/mcp-suggested-prompts-services.js';
import type { McpSuggestedPromptsServices } from './services/mcp-suggested-prompts-services.js';

export interface ScreenServices {
  mcpInstaller: McpInstaller;
  mcpSuggestedPromptsServices: McpSuggestedPromptsServices;
}

export function createServices(store: WizardStore): ScreenServices {
  return {
    mcpInstaller: createMcpInstaller(),
    mcpSuggestedPromptsServices: createMcpSuggestedPromptsServices(store),
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
    [Overlay.ManualAuthCode]: <ManualAuthCodeScreen store={store} />,
    [Overlay.AuthError]: <AuthErrorScreen store={store} />,
    [Overlay.SessionTimeout]: <SessionTimeoutScreen store={store} />,
    [Overlay.WizardAsk]: <WizardAskScreen store={store} />,

    // Wizard flow
    [ScreenId.Intro]: <PostHogIntegrationIntroScreen store={store} />,
    [ScreenId.RevenueIntro]: <RevenueIntroScreen store={store} />,
    [ScreenId.WarehouseIntro]: <WarehouseIntroScreen store={store} />,
    [ScreenId.SourceMapsIntro]: <SourceMapsIntroScreen store={store} />,
    [ScreenId.SourceMapsDetect]: <SourceMapsDetectScreen store={store} />,
    [ScreenId.SourceMapsOutro]: <SourceMapsOutroScreen store={store} />,
    [ScreenId.MigrationIntro]: <MigrationIntroScreen store={store} />,
    [ScreenId.AgentSkillIntro]: <AgentSkillIntroScreen store={store} />,
    [ScreenId.SelfDrivingIntro]: <SelfDrivingIntroScreen store={store} />,
    [ScreenId.AuditIntro]: <AuditIntroScreen store={store} />,
    [ScreenId.AuditRun]: <AuditRunScreen store={store} />,
    [ScreenId.AuditOutro]: <AuditOutroScreen store={store} />,
    [ScreenId.HealthCheck]: <HealthCheckScreen store={store} />,
    [ScreenId.DoctorIntro]: <DoctorIntroScreen store={store} />,
    [ScreenId.DoctorReport]: <DoctorReportScreen store={store} />,
    [ScreenId.Setup]: <SetupScreen store={store} />,
    [ScreenId.Auth]: <AuthScreen store={store} />,
    [ScreenId.AiOptIn]: <AiOptInRequiredScreen store={store} />,
    [ScreenId.Run]: <RunScreen store={store} />,
    [ScreenId.Mcp]: (
      <McpScreen store={store} installer={services.mcpInstaller} />
    ),
    [ScreenId.McpSuggestedPrompts]: (
      <McpSuggestedPromptsScreen
        store={store}
        services={services.mcpSuggestedPromptsServices}
      />
    ),
    [ScreenId.SlackConnect]: <SlackConnectScreen store={store} />,
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
