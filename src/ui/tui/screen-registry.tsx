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
import path from 'node:path';
import { getLogFilePath } from '@utils/debug';
import type { WizardStore } from '../../tui/store.js';
import { ScreenId, Overlay, type ScreenName } from '../../tui/router.js';

import { HealthCheckScreen } from '../../tui/screens/health/HealthCheckScreen.js';
import { DoctorIntroScreen } from '../../tui/tools/doctor/screens/DoctorIntroScreen.js';
import { DoctorReportScreen } from '../../tui/tools/doctor/screens/DoctorReportScreen.js';
import { SettingsOverrideScreen } from '../../tui/screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from '../../tui/screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from '../../tui/screens/PortConflictScreen.js';
import { TaskNoticeScreen } from '../../tui/screens/TaskNoticeScreen.js';
import { ManualAuthCodeScreen } from '../../tui/screens/ManualAuthCodeScreen.js';
import { PostHogIntegrationIntroScreen } from '../../tui/programs/posthog-integration/screens/PostHogIntegrationIntroScreen.js';
import { RevenueIntroScreen } from '../../tui/programs/revenue-analytics/screens/RevenueIntroScreen.js';
import { WarehouseIntroScreen } from '../../tui/programs/warehouse-source/screens/WarehouseIntroScreen.js';
import { MigrationIntroScreen } from '../../tui/programs/migration/screens/MigrationIntroScreen.js';
import { SourceMapsIntroScreen } from '../../tui/programs/error-tracking-upload-source-maps/screens/SourceMapsIntroScreen.js';
import { SourceMapsDetectScreen } from '../../tui/programs/error-tracking-upload-source-maps/screens/SourceMapsDetectScreen.js';
import { SourceMapsOutroScreen } from '../../tui/programs/error-tracking-upload-source-maps/screens/SourceMapsOutroScreen.js';
import { AgentSkillIntroScreen } from '../../tui/programs/shared/screens/AgentSkillIntroScreen.js';
import { AiObservabilityIntroScreen } from '../../tui/programs/ai-observability/screens/AiObservabilityIntroScreen.js';
import { MetricsIntroScreen } from '../../tui/programs/metrics/screens/MetricsIntroScreen.js';
import { ErrorTrackingIntroScreen } from '../../tui/programs/error-tracking/screens/ErrorTrackingIntroScreen.js';
import { FeatureFlagsIntroScreen } from '../../tui/programs/feature-flags/screens/FeatureFlagsIntroScreen.js';
import { ErrorTrackingDetectScreen } from '../../tui/programs/error-tracking/screens/ErrorTrackingDetectScreen.js';
import { SelfDrivingIntroScreen } from '../../tui/programs/self-driving/screens/SelfDrivingIntroScreen.js';
import { SelfDrivingIntegrationCheckScreen } from '../../tui/programs/self-driving/screens/SelfDrivingIntegrationCheckScreen.js';
import { SelfDrivingIntegrationDetectScreen } from '../../tui/programs/self-driving/screens/SelfDrivingIntegrationDetectScreen.js';
import { SelfDrivingHandoffScreen } from '../../tui/programs/self-driving/screens/SelfDrivingHandoffScreen.js';
import { SelfDrivingGitHubScreen } from '@tui/programs/self-driving/screens/SelfDrivingGitHubScreen';
import { AuditIntroScreen } from '../../tui/programs/audit/screens/AuditIntroScreen.js';
import { AuditRunScreen } from '../../tui/programs/audit/screens/AuditRunScreen.js';
import { AuditOutroScreen } from '../../tui/programs/audit/screens/AuditOutroScreen.js';
import { SetupScreen } from '../../tui/screens/SetupScreen.js';
import { AuthScreen } from '../../tui/screens/AuthScreen.js';
import { AiOptInRequiredScreen } from '../../tui/screens/AiOptInRequiredScreen.js';
import { RunScreen } from '../../tui/screens/RunScreen.js';
import { McpScreen } from '../../tui/screens/McpScreen.js';
import { McpSuggestedPromptsScreen } from '../../tui/tools/mcp/screens/McpSuggestedPromptsScreen.js';
import { SlackConnectScreen } from '../../tui/screens/SlackConnectScreen.js';
import { KeepSkillsScreen } from '../../tui/screens/KeepSkillsScreen.js';
import { OutroScreen } from '../../tui/screens/OutroScreen.js';
import { MintFailureScreen } from '../../tui/screens/MintFailureScreen.js';
import type { MintFailureServices } from '../../tui/screens/MintFailureScreen.js';
import { openCodingAgent } from '../../tui/services/coding-agent-launcher.js';
import { writeWizardSpellbook } from '@tui/services/wizard-spellbook';
import { getProgramConfig } from '@programs';
import { ExitScreen } from '../../tui/screens/ExitScreen.js';
import { AuthErrorScreen } from '../../tui/screens/AuthErrorScreen.js';
import { SessionTimeoutScreen } from '../../tui/screens/SessionTimeoutScreen.js';
import { WizardAskScreen } from '../../tui/screens/WizardAskScreen.js';
import { createMcpInstaller } from '../../tui/services/mcp-installer.js';
import type { McpInstaller } from '../../tui/services/mcp-installer.js';
import { createMcpSuggestedPromptsServices } from '../../tui/tools/mcp/services/suggested-prompts.js';
import type { McpSuggestedPromptsServices } from '../../tui/tools/mcp/services/suggested-prompts.js';

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
    [ScreenId.FeatureFlagsIntro]: <FeatureFlagsIntroScreen store={store} />,
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
