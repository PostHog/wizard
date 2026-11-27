# Proposal: a saved web analytics conversion goal

Status: proposal for the posthog repo. Nothing here is built.

## Problem

The wizard's web analytics step creates a conversion goal for the user. PostHog
has nowhere to save it. In the web analytics scene, the goal lives only in the
URL (`conversionGoal.actionId`, `conversionGoal.customEventName`) and in
team-scoped localStorage (`webAnalyticsLogic.tsx`, the `conversionGoal` reducer).
So the wizard creates an action and hands the user a link with the goal
preselected. A teammate who opens web analytics without that link sees no goal.

Marketing analytics has saved conversion goals
(`TeamMarketingAnalyticsConfig._conversion_goals` and the
`marketing-analytics-*-conversion-goal` MCP tools), but web analytics does not
read them.

## Proposal

1. **Store one default goal per project.** Add `web_analytics_conversion_goal`
   to the team, or to a web analytics team config beside the marketing one. It
   holds an `ActionConversionGoal | CustomEventConversionGoal`, the shape the
   queries already take, or null.
2. **Read it as the scene's default.** `webAnalyticsLogic` starts from the saved
   goal when the URL and localStorage carry none. Picking another goal in the
   scene changes only the view, as it does today, and a "Set as default" action
   saves it.
3. **Expose it to agents.** A team serializer field reaches the MCP through
   `project-settings-update` with no new tool. Validate that the action exists
   in the project and belongs to the team.

## Nice to have for the same flow

- **A `health-issues-refresh` MCP tool.** The health checks already cover
  authorized URLs, the reverse proxy, pageleave and web vitals, but only the UI
  can trigger a refresh. With the tool, the wizard could verify the setup at
  the end of a run, instead of the user waiting for the next scheduled check.
- **An onboarding signal.** Saving the default goal could complete the
  `SetUpWebAnalyticsConversionGoals` setup task. Today only picking a goal in
  the scene completes it.
