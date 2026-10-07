/** The `wizard slack` TUI: the shared Connect-Slack screen as the whole flow. */
import type { TuiTools } from '@tui/tools/types';
import { SLACK_FLOW } from './flow.js';

export const TUI_TOOLS: TuiTools = { slack: { flow: SLACK_FLOW } };
