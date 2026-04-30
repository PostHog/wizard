import { Box, Text } from 'ink';

const PostHogAiPrompt = ({ prompt }: { prompt: string }) => (
  <Box flexDirection="column">
    <Text>Try asking PostHog AI</Text>
    <Box height={1} />
    <Text color="cyan" bold underline>
      "{prompt}" ↗
    </Text>
  </Box>
);

export const AiQueryDraftingSlide = () => (
  <PostHogAiPrompt prompt="What changed in activation this week, and which events explain the movement?" />
);

export const AiSessionReviewSlide = () => (
  <PostHogAiPrompt prompt="Summarize sessions where users dropped off at checkout." />
);

export const AiIncidentTriageSlide = () => (
  <PostHogAiPrompt prompt="Why is this exception happening, and which users and flows are affected?" />
);

export const ReplayMcpFixSlide = () => (
  <PostHogAiPrompt prompt="Find session replays around this error and summarize the steps that led to it." />
);

export const AiDashboardBuilderSlide = () => (
  <PostHogAiPrompt prompt="Create a dashboard for signup, activation, retention, and paid conversion." />
);

export const AiReplayPatternsSlide = () => (
  <PostHogAiPrompt prompt="What patterns do you see in sessions with rage clicks?" />
);

export const AiMcpWorkflowSlide = () => (
  <PostHogAiPrompt prompt="Find sessions around this error and give my coding agent the context to fix it." />
);

export const AiModelCostSlide = () => (
  <PostHogAiPrompt prompt="Which prompts and models have the highest latency and cost this week?" />
);

export const AiQualityRegressionSlide = () => (
  <PostHogAiPrompt prompt="Did output quality regress after our last prompt or model change?" />
);
