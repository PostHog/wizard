/**
 * `wizard slack`: the Connect Slack screen the MCP and integration flows end
 * on, as the whole flow. The screen renders the no-creds nudge and logs in
 * only when the user opens Slack setup: connecting Slack happens in the
 * browser, so a wizard login up front adds nothing.
 */

import type { ToolConfig } from '../types';

export const SLACK: ToolConfig = {
  id: 'slack',
  command: 'slack',
  description: 'Connect PostHog to your Slack',
};
