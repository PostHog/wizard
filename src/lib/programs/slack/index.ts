/**
 * Slack connect program — TUI-only flow invoked by `wizard slack`. One
 * step: the same Connect Slack screen the MCP flows end on. OAuth kicks
 * off from `onInit` while the screen renders the auth-wait state; the
 * connected poll starts once credentials land.
 */

import type { ProgramConfig } from '@lib/programs/program-step';
import { getOrAskForProjectData } from '@utils/setup-utils';
import { getUI } from '@ui';
import { analytics } from '@utils/analytics';

export const slackConnectConfig: ProgramConfig = {
  id: 'slack',
  description: 'Connect PostHog to your Slack',
  steps: [
    {
      id: 'slack-connect',
      label: 'Connect Slack',
      screenId: 'slack-connect',
      isComplete: (s) => s.slackStepDismissed,
      onInit: loginForSlackConnect,
    },
  ],
};

/** OAuth for the standalone flow. The screen shows the auth-wait state
 *  (and the login URL) until the credentials land in the store. */
function loginForSlackConnect(): void {
  void (async () => {
    try {
      const data = await getOrAskForProjectData({
        signup: false,
        ci: false,
        apiKey: undefined,
        projectId: undefined,
        programId: 'slack',
      });
      const ui = getUI();
      ui.setCredentials({
        accessToken: data.accessToken,
        projectApiKey: data.projectApiKey,
        host: data.host,
        projectId: data.projectId,
      });
      ui.setRoleAtOrganization(data.roleAtOrganization);
      ui.setApiUser(data.user);
      ui.setLoginUrl(null);
    } catch (err) {
      analytics.captureException(
        err instanceof Error ? err : new Error(String(err)),
        { step: 'slack_connect_login' },
      );
      getUI().log.error(
        `Login failed. ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exit(1);
    }
  })();
}
