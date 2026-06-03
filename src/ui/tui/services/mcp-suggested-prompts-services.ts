/**
 * McpSuggestedPromptsServices — service layer between
 * McpSuggestedPromptsScreen and the network. Decouples the screen from
 * OAuth and the activity-log probe so the playground can inject mocks
 * (skip login, canned activity responses) without a special-case branch
 * in the screen itself.
 *
 * Mirrors the McpInstaller pattern: thin interface, production factory
 * that wires the real implementation, no dynamic imports in the React tree.
 */

import { fetchRecentActivity, type ActivityLogEntry } from '@lib/api';
import type { Credentials } from '@lib/wizard-session';
import { getOrAskForProjectData } from '@utils/setup-utils';
import type { WizardStore } from '@ui/tui/store';

export interface McpSuggestedPromptsServices {
  /**
   * Kicks off the OAuth dance. Production wires this to
   * `getOrAskForProjectData`; the playground returns canned values
   * after a fake delay.
   *
   * While the promise is pending, the implementation is expected to set
   * `session.loginUrl` (via `store.setLoginUrl`) so the screen can
   * render the URL inline. Mocks may set/clear this URL too if they
   * want to exercise the spinner + URL layout.
   */
  performLogin(): Promise<{
    credentials: Credentials;
    roleAtOrganization: string | null;
  }>;

  /**
   * Best-effort activity-log probe. Production wires this to
   * `fetchRecentActivity`; the playground returns canned entries.
   * Returns `[]` on any error — the caller treats absence of results
   * as "haven't detected anything yet" rather than a hard failure.
   */
  fetchActivitySince(args: {
    accessToken: string;
    projectId: number;
    host: string;
    since: Date;
  }): Promise<ActivityLogEntry[]>;
}

/**
 * Production services. Set the login URL is handled by
 * `getOrAskForProjectData` → `askForWizardLogin` internally; this
 * factory just unwraps the result into the screen's expected shape.
 */
export function createMcpSuggestedPromptsServices(
  _store: WizardStore,
): McpSuggestedPromptsServices {
  return {
    performLogin: async () => {
      const result = await getOrAskForProjectData({
        signup: false,
        ci: false,
        apiKey: undefined,
        projectId: undefined,
        email: undefined,
        region: undefined,
      });
      return {
        credentials: {
          accessToken: result.accessToken,
          projectApiKey: result.projectApiKey,
          host: result.host,
          projectId: result.projectId,
        },
        roleAtOrganization: result.roleAtOrganization,
      };
    },

    fetchActivitySince: ({ accessToken, projectId, host, since }) =>
      fetchRecentActivity(accessToken, projectId, host, since),
  };
}
