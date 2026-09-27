/**
 * ScreenId registry — maps screen names to React components.
 *
 * Adding a new screen:
 *   1. Create the component in screens/, or programs/<program>/screens/ for one program.
 *   2. Add a `ScreenId` enum entry in screen-sequences.ts.
 *   3. Add an entry here.
 *   4. Reference the screen by name in the program's `steps` array.
 */

import type { ReactNode } from 'react';
import path from 'node:path';
import { getLogFilePath } from '@utils/debug';
import type { WizardStore } from './store.js';
import { ScreenId, Overlay, type ScreenName } from './router.js';

import { HealthCheckScreen } from './screens/health/HealthCheckScreen.js';
import { DoctorIntroScreen } from './programs/posthog-doctor/screens/DoctorIntroScreen.js';
import { DoctorReportScreen } from './programs/posthog-doctor/screens/DoctorReportScreen.js';
import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from './screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from './screens/PortConflictScreen.js';
import { TaskNoticeScreen } from './screens/TaskNoticeScreen.js';
import { ManualAuthCodeScreen } from './screens/ManualAuthCodeScreen.js';
import { PostHogIntegrationIntroScreen } from './programs/posthog-integration/screens/PostHogIntegrationIntroScreen.js';
import { RevenueIntroScreen } from './programs/revenue-analytics/screens/RevenueIntroScreen.js';
import { WarehouseIntroScreen } from './programs/warehouse-source/screens/WarehouseIntroScreen.js';
import { MigrationIntroScreen } from './programs/migration/screens/MigrationIntroScreen.js';
import { SourceMapsIntroScreen } from './programs/error-tracking-upload-source-maps/screens/SourceMapsIntroScreen.js';
import { SourceMapsDetectScreen } from './programs/error-tracking-upload-source-maps/screens/SourceMapsDetectScreen.js';
import { SourceMapsOutroScreen } from './programs/error-tracking-upload-source-maps/screens/SourceMapsOutroScreen.js';
import { AgentSkillIntroScreen } from './screens/AgentSkillIntroScreen.js';
import { AiObservabilityIntroScreen } from './programs/ai-observability/screens/AiObservabilityIntroScreen.js';
import { MetricsIntroScreen } from './programs/metrics/screens/MetricsIntroScreen.js';
import { ErrorTrackingIntroScreen } from './programs/error-tracking/screens/ErrorTrackingIntroScreen.js';
import { ErrorTrackingDetectScreen } from './programs/error-tracking/screens/ErrorTrackingDetectScreen.js';
import { SelfDrivingIntroScreen } from './programs/self-driving/screens/SelfDrivingIntroScreen.js';
import { SelfDrivingIntegrationCheckScreen } from './programs/self-driving/screens/SelfDrivingIntegrationCheckScreen.js';
import { SelfDrivingIntegrationDetectScreen } from './programs/self-driving/screens/SelfDrivingIntegrationDetectScreen.js';
import { SelfDrivingHandoffScreen } from './programs/self-driving/screens/SelfDrivingHandoffScreen.js';
import { SelfDrivingGitHubScreen } from '@tui/programs/self-driving/screens/SelfDrivingGitHubScreen';
import { AuditIntroScreen } from './programs/audit/screens/AuditIntroScreen.js';
import { AuditRunScreen } from './programs/audit/screens/AuditRunScreen.js';
import { AuditOutroScreen } from './programs/audit/screens/AuditOutroScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { AiOptInRequiredScreen } from './screens/AiOptInRequiredScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
import { McpSuggestedPromptsScreen } from './screens/McpSuggestedPromptsScreen.js';
import { SlackConnectScreen } from './screens/SlackConnectScreen.js';
import { KeepSkillsScreen } from './screens/KeepSkillsScreen.js';
import { OutroScreen } from './screens/OutroScreen.js';
import { MintFailureScreen } from './screens/MintFailureScreen.js';
import type { MintFailureServices } from './screens/MintFailureScreen.js';
import { openCodingAgent } from './services/coding-agent-launcher.js';
import { writeWizardSpellbook } from '@tui/services/wizard-spellbook';
import { getProgramConfig } from '@programs';
import { ExitScreen } from './screens/ExitScreen.js';
import { AuthErrorScreen } from './screens/AuthErrorScreen.js';
import { SessionTimeoutScreen } from './screens/SessionTimeoutScreen.js';
import { WizardAskScreen } from './screens/WizardAskScreen.js';
import { createMcpInstaller } from './services/mcp-installer.js';
import type { McpInstaller } from './services/mcp-installer.js';
import { createMcpSuggestedPromptsServices } from './services/mcp-suggested-prompts-services.js';
import type { McpSuggestedPromptsServices } from './services/mcp-suggested-prompts-services.js';

export interface ScreenServices extends MintFailureServices {
  mcpInstaller: McpInstaller;
  mcpSuggestedPromptsServices: McpSuggestedPromptsServices;
}

export function createServices(store: WizardStore): ScreenServices {
  return {
    get logPath() {
      return path.resolve(getLogFilePath());
    },
    openAgent: (agent, spellbookPath) =>
      openCodingAgent(agent, store.session.installDir, spellbookPath),
    leaveSpellbook: () =>
      writeWizardSpellbook(
        store.session,
        getProgramConfig(store.router.activeProgram),
      ),
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
    [Overlay.TaskNotice]: <TaskNoticeScreen store={store} />,
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
    [ScreenId.AiObservabilityIntro]: (
      <AiObservabilityIntroScreen store={store} />
    ),
    [ScreenId.MetricsIntro]: <MetricsIntroScreen store={store} />,
    [ScreenId.ErrorTrackingIntro]: <ErrorTrackingIntroScreen store={store} />,
    [ScreenId.ErrorTrackingDetect]: <ErrorTrackingDetectScreen store={store} />,
    [ScreenId.SelfDrivingIntro]: <SelfDrivingIntroScreen store={store} />,
    [ScreenId.SelfDrivingIntegrationCheck]: (
      <SelfDrivingIntegrationCheckScreen store={store} />
    ),
    [ScreenId.SelfDrivingIntegrationDetect]: (
      <SelfDrivingIntegrationDetectScreen store={store} />
    ),
    [ScreenId.SelfDrivingHandoff]: <SelfDrivingHandoffScreen store={store} />,
    [ScreenId.SelfDrivingGithub]: <SelfDrivingGitHubScreen store={store} />,
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
    [ScreenId.MintFailure]: (
      <MintFailureScreen store={store} services={services} />
    ),
    [ScreenId.Exit]: <ExitScreen store={store} />,

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
