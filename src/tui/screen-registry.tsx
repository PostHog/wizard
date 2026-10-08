/**
 * Screen registry — maps screen names to React components.
 *
 * The core mounts its own screens and overlays here. Each program's screens
 * come from its TUI entry (`programs/<id>/index.ts`, `screens`), so adding a
 * program screen touches only that program's folder:
 *   1. Create the component in programs/<id>/screens/.
 *   2. Name its id in programs/<id>/screen-ids.ts.
 *   3. Map the id to the component in the entry's `screens`.
 *   4. Reference the id by `screenId` in the program's flow.
 */

import type { ReactNode } from 'react';
import path from 'node:path';
import { getLogFilePath } from '@utils/debug';
import type { WizardStore } from './store.js';
import { ScreenId, Overlay, type ScreenName } from './router.js';
import { listFlowOwners } from './flow-owner.js';

import { HealthCheckScreen } from './screens/health/HealthCheckScreen.js';
import { SettingsOverrideScreen } from './screens/SettingsOverrideScreen.js';
import { ManagedSettingsScreen } from './screens/ManagedSettingsScreen.js';
import { PortConflictScreen } from './screens/PortConflictScreen.js';
import { TaskNoticeScreen } from './screens/TaskNoticeScreen.js';
import { ManualAuthCodeScreen } from './screens/ManualAuthCodeScreen.js';
import { SetupScreen } from './screens/SetupScreen.js';
import { AuthScreen } from './screens/AuthScreen.js';
import { AiOptInRequiredScreen } from './screens/AiOptInRequiredScreen.js';
import { RunScreen } from './screens/RunScreen.js';
import { McpScreen } from './screens/McpScreen.js';
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

export interface ScreenServices extends MintFailureServices {
  mcpInstaller: McpInstaller;
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
  };
}

export function createScreens(
  store: WizardStore,
  services: ScreenServices,
): Record<ScreenName, ReactNode> {
  const programScreens: Record<string, ReactNode> = {};
  for (const program of listFlowOwners()) {
    for (const [id, render] of Object.entries(program.screens ?? {})) {
      programScreens[id] ??= render(store, services);
    }
  }
  // Typed on the core ids, so a core screen without a mount fails to compile.
  const core: Record<ScreenId | Overlay, ReactNode> = {
    // Overlays
    [Overlay.SettingsOverride]: <SettingsOverrideScreen store={store} />,
    [Overlay.ManagedSettings]: <ManagedSettingsScreen store={store} />,
    [Overlay.PortConflict]: <PortConflictScreen store={store} />,
    [Overlay.TaskNotice]: <TaskNoticeScreen store={store} />,
    [Overlay.ManualAuthCode]: <ManualAuthCodeScreen store={store} />,
    [Overlay.AuthError]: <AuthErrorScreen store={store} />,
    [Overlay.SessionTimeout]: <SessionTimeoutScreen store={store} />,
    [Overlay.WizardAsk]: <WizardAskScreen store={store} />,

    // Core flow screens
    [ScreenId.HealthCheck]: <HealthCheckScreen store={store} />,
    [ScreenId.Setup]: <SetupScreen store={store} />,
    [ScreenId.Auth]: <AuthScreen store={store} />,
    [ScreenId.AiOptIn]: <AiOptInRequiredScreen store={store} />,
    [ScreenId.Run]: <RunScreen store={store} />,
    [ScreenId.Mcp]: (
      <McpScreen store={store} installer={services.mcpInstaller} />
    ),
    [ScreenId.SlackConnect]: <SlackConnectScreen store={store} />,
    [ScreenId.KeepSkills]: <KeepSkillsScreen store={store} />,
    [ScreenId.Outro]: <OutroScreen store={store} />,
    [ScreenId.MintFailure]: (
      <MintFailureScreen store={store} services={services} />
    ),
    [ScreenId.Exit]: <ExitScreen store={store} />,
  };
  return { ...programScreens, ...core };
}
