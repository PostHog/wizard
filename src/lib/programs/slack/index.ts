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
      onInit: () => {
        void getOrAskForProjectData({
          signup: false,
          ci: false,
          apiKey: undefined,
          projectId: undefined,
          programId: 'slack',
        })
          .then(
            ({
              accessToken,
              projectApiKey,
              host,
              projectId,
              roleAtOrganization,
              user,
            }) => {
              getUI().setCredentials({
                accessToken,
                projectApiKey,
                host,
                projectId,
              });
              getUI().setRoleAtOrganization(roleAtOrganization);
              getUI().setApiUser(user);
              getUI().setLoginUrl(null);
            },
          )
          .catch((err: unknown) => {
            analytics.captureException(
              err instanceof Error ? err : new Error(String(err)),
              { step: 'slack_connect_login' },
            );
            getUI().log.error(
              `Login failed. ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
            process.exit(1);
          });
      },
    },
  ],
};
